/**
 * The local turn: the agent's model on the person's own key, its tools, and the
 * approval gate, emitted as AG-UI events. Earth Care Cloud runs the same shape
 * on Jaguar server-side (ecn.ts cloudRun).
 */
import type { AguiEvent, ApprovalRequest } from "./agui";
import type { Agent } from "./agents";
import { systemPrompt } from "./agents";
import { applyDecision, needsApproval, canAlwaysAllow, summarize, type Decision, type Policy } from "./approvals";
import { safeJson, streamChat, type ChatMessage, type FetchLike, type ProviderConfig, type ToolCall } from "./providers";
import type { ToolContext, ToolHandler } from "./tools";

export const MAX_STEPS = 12;

export type LocalTurn = {
  agent: Agent;
  team: Agent[];
  /** Conversation so far, without the system prompt. New messages are appended in place. */
  history: ChatMessage[];
  provider: ProviderConfig;
  tools: ToolHandler[];
  ctx: ToolContext;
  policy: Policy;
  onPolicy?: (p: Policy) => void;
  askApproval: (req: ApprovalRequest) => Promise<Decision>;
  /** Nobody is watching (a routine): every non-read call asks, so it is not done. */
  unattended?: boolean;
  fetchImpl: FetchLike;
  signal?: AbortSignal;
  threadId: string;
  runId: string;
  maxSteps?: number;
};

let seq = 0;
const abortError = () => Object.assign(new Error("Stopped."), { name: "AbortError" });
const nextId = (p: string) => `${p}-${Date.now().toString(36)}-${(seq++).toString(36)}`;

export async function* runLocalTurn(t: LocalTurn): AsyncGenerator<AguiEvent> {
  yield { type: "RUN_STARTED", threadId: t.threadId, runId: t.runId };
  const byName = new Map(t.tools.map((h) => [h.spec.name, h]));
  let policy = t.policy;
  const steps = Math.min(t.maxSteps ?? MAX_STEPS, 20);
  let lastHadText = false;
  let toolsRan = 0;
  try {
    let capped = true;
    for (let step = 0; step < steps; step++) {
      const messages: ChatMessage[] = [{ role: "system", content: systemPrompt(t.agent, t.team) }, ...t.history];
      const messageId = nextId("msg");
      let text = "";
      const calls: ToolCall[] = [];
      let started = false;
      for await (const part of streamChat(
        { provider: t.provider, model: t.agent.model.model, messages, tools: t.tools.map((h) => h.spec), signal: t.signal },
        t.fetchImpl,
      )) {
        if (part.type === "text") {
          if (!started) {
            yield { type: "TEXT_MESSAGE_START", messageId, role: "assistant" };
            started = true;
          }
          text += part.delta;
          yield { type: "TEXT_MESSAGE_CONTENT", messageId, delta: part.delta };
        } else if (part.type === "tool_call_start") {
          const prev = calls[part.index];
          if (prev && (prev.id === part.id || !part.name)) {
            if (part.name) prev.name = part.name;
          } else {
            calls[part.index] = { id: part.id, name: part.name, arguments: "" };
            yield { type: "TOOL_CALL_START", toolCallId: part.id, toolCallName: part.name, parentMessageId: messageId };
          }
        } else if (part.type === "tool_call_args") {
          const c = calls[part.index];
          if (c) {
            c.arguments += part.delta;
            yield { type: "TOOL_CALL_ARGS", toolCallId: c.id, delta: part.delta };
          }
        }
      }
      if (started) yield { type: "TEXT_MESSAGE_END", messageId };
      const toolCalls = calls.filter(Boolean);
      // A step with neither words nor calls is not a message: both providers refuse an empty one.
      if (text || toolCalls.length) t.history.push({ role: "assistant", content: text, toolCalls: toolCalls.length ? toolCalls : undefined });
      lastHadText = !!text.trim();
      if (!toolCalls.length) {
        capped = false;
        break;
      }

      for (const call of toolCalls) {
        if (t.signal?.aborted) throw abortError();
        yield { type: "TOOL_CALL_END", toolCallId: call.id };
        const handler = byName.get(call.name);
        const args = safeJson(call.arguments);
        let result: string;
        if (!handler) result = `Error: there is no tool ${call.name}.`;
        else if (needsApproval(call.name, policy, handler.annotations, args, !!t.unattended)) {
          const req: ApprovalRequest = { id: nextId("ask"), toolCallId: call.id, tool: call.name, summary: summarize(call.name, args), args, canAlways: canAlwaysAllow(call.name, handler.annotations, args) };
          yield { type: "CUSTOM", name: "approval_request", value: req };
          const decision = await t.askApproval(req);
          if (t.signal?.aborted) throw abortError();
          if (decision === "refuse" || decision === "unattended") {
            yield { type: "CUSTOM", name: "approval_refused", value: { toolCallId: call.id } };
            result =
              decision === "refuse"
                ? "The person refused. Nothing was done. Say so plainly and don't try again unless they ask."
                : "No one was there to approve this, so it was not done. Say it needs their yes, and what it would do.";
          } else {
            policy = applyDecision(policy, call.name, decision, handler.annotations, args);
            t.onPolicy?.(policy);
            result = await safeRun(handler, args, t.ctx);
          }
        } else result = await safeRun(handler, args, t.ctx);
        toolsRan++;
        yield { type: "TOOL_CALL_RESULT", toolCallId: call.id, content: result };
        t.history.push({ role: "tool", toolCallId: call.id, name: call.name, content: result });
      }
    }
    if (!lastHadText) {
      // Never end on silence or a preamble: say what happened (Jaguar's turn-honesty rule).
      const ran = toolsRan;
      const messageId = nextId("msg");
      const line = capped
        ? "I ran out of steps before I could finish. Ask me to carry on."
        : ran
          ? "I ran the steps above but didn't write an answer. Ask me to sum up."
          : "I don't have an answer for that yet.";
      yield { type: "TEXT_MESSAGE_START", messageId, role: "assistant" };
      yield { type: "TEXT_MESSAGE_CONTENT", messageId, delta: line };
      yield { type: "TEXT_MESSAGE_END", messageId };
      t.history.push({ role: "assistant", content: line });
    }
    yield { type: "RUN_FINISHED", threadId: t.threadId, runId: t.runId };
  } catch (err) {
    if ((err as Error)?.name === "AbortError") {
      yield { type: "RUN_ERROR", message: "Stopped.", code: "aborted" };
      return;
    }
    yield { type: "RUN_ERROR", message: (err as Error)?.message || "Something went wrong." };
  }
}

async function safeRun(h: ToolHandler, args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
  try {
    return (await h.run(args, ctx)).slice(0, 16_000);
  } catch (err) {
    return `Error: ${(err as Error)?.message || "the tool failed."}`;
  }
}

/** Run a turn to the end and return its last answer (handoffs, routines). */
export async function finalAnswer(gen: AsyncGenerator<AguiEvent>): Promise<string> {
  let text = "";
  let current = "";
  for await (const e of gen) {
    if (e.type === "TEXT_MESSAGE_START") current = "";
    if (e.type === "TEXT_MESSAGE_CONTENT") current += e.delta;
    if (e.type === "TEXT_MESSAGE_END") text = current;
    if (e.type === "RUN_ERROR") return `Error: ${e.message}`;
  }
  return text || current;
}
