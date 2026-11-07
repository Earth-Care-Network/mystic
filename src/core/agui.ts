/**
 * AG-UI events (https://github.com/ag-ui-protocol/ag-ui), the one wire Mystic draws.
 *
 * The local loop emits them, and Earth Care Cloud (Jaguar, /api/v1/mystic/cloud/run/)
 * streams them, so a turn looks the same whichever runs it. This is the subset
 * OpenDuet's server and ECN's AG-UI contract (docs/api/agui-contract.md) both use.
 */
export type AguiEvent =
  | { type: "RUN_STARTED"; threadId: string; runId: string }
  | { type: "RUN_FINISHED"; threadId: string; runId: string }
  | { type: "RUN_ERROR"; message: string; code?: string }
  | { type: "TEXT_MESSAGE_START"; messageId: string; role: "assistant" }
  | { type: "TEXT_MESSAGE_CONTENT"; messageId: string; delta: string }
  | { type: "TEXT_MESSAGE_END"; messageId: string }
  | { type: "TOOL_CALL_START"; toolCallId: string; toolCallName: string; parentMessageId?: string; needsApproval?: boolean }
  | { type: "TOOL_CALL_ARGS"; toolCallId: string; delta: string }
  | { type: "TOOL_CALL_END"; toolCallId: string }
  | { type: "TOOL_CALL_RESULT"; toolCallId: string; content: string; messageId?: string }
  | { type: "STATE_DELTA"; delta: unknown[] }
  | { type: "CUSTOM"; name: string; value: unknown };

export type ToolCallView = {
  id: string;
  name: string;
  args: string;
  result?: string;
  /** `portal`: an Earth Care Cloud card waiting for the person in Earth Care Network. */
  status: "running" | "waiting" | "done" | "refused" | "portal" | "not_run";
};

export type TurnView = {
  runId: string;
  text: string;
  tools: ToolCallView[];
  error?: { message: string; code?: string };
  finished: boolean;
  /** Approvals this turn is waiting on (CUSTOM approval_request). */
  approvals: ApprovalRequest[];
  /** The Earth Care Network thread a cloud turn ran on (STATE_DELTA /thread_id). */
  threadId?: string;
};

export type ApprovalRequest = {
  id: string;
  toolCallId: string;
  tool: string;
  summary: string;
  args: Record<string, unknown>;
};

export function emptyTurn(runId = ""): TurnView {
  return { runId, text: "", tools: [], finished: false, approvals: [] };
}

/** Fold one event into the turn the screen draws. Pure, so local and cloud share it. */
export function reduce(turn: TurnView, e: AguiEvent): TurnView {
  switch (e.type) {
    case "RUN_STARTED":
      return { ...emptyTurn(e.runId) };
    case "TEXT_MESSAGE_START":
      // A turn can speak more than once (before and after a tool): keep them as paragraphs.
      return turn.text && !/\s$/.test(turn.text) ? { ...turn, text: `${turn.text}\n\n` } : turn;
    case "TEXT_MESSAGE_CONTENT":
      return { ...turn, text: turn.text + e.delta };
    case "TOOL_CALL_START":
      return {
        ...turn,
        tools: [...turn.tools, { id: e.toolCallId, name: e.toolCallName, args: "", status: e.needsApproval ? "portal" : "running" }],
      };
    case "TOOL_CALL_ARGS":
      return {
        ...turn,
        tools: turn.tools.map((t) => (t.id === e.toolCallId ? { ...t, args: t.args + e.delta } : t)),
      };
    case "TOOL_CALL_RESULT":
      return {
        ...turn,
        // A refused call still gets a result (what the model is told); it stays "refused".
        tools: turn.tools.map((t) => (t.id === e.toolCallId ? { ...t, result: e.content, status: t.status === "refused" ? "refused" : "done" } : t)),
        approvals: turn.approvals.filter((a) => a.toolCallId !== e.toolCallId),
      };
    case "STATE_DELTA": {
      for (const op of e.delta as { op?: string; path?: string; value?: unknown }[]) {
        if (op && (op.op === "add" || op.op === "replace") && op.path === "/thread_id" && typeof op.value === "string")
          return { ...turn, threadId: op.value };
      }
      return turn;
    }
    case "CUSTOM":
      if (e.name === "answer_corrected") {
        const v = e.value as { content?: string };
        return typeof v?.content === "string" ? { ...turn, text: v.content } : turn;
      }
      if (e.name === "approval_request") {
        const a = e.value as ApprovalRequest;
        return {
          ...turn,
          approvals: [...turn.approvals, a],
          tools: turn.tools.map((t) => (t.id === a.toolCallId ? { ...t, status: "waiting" } : t)),
        };
      }
      if (e.name === "approval_refused") {
        const id = (e.value as { toolCallId: string }).toolCallId;
        return {
          ...turn,
          approvals: turn.approvals.filter((a) => a.toolCallId !== id),
          tools: turn.tools.map((t) => (t.id === id ? { ...t, status: "refused" } : t)),
        };
      }
      return turn;
    case "RUN_ERROR":
      return { ...settle(turn), error: { message: e.message, code: e.code }, finished: true };
    case "RUN_FINISHED":
      return { ...settle(turn), finished: true };
    default:
      return turn;
  }
}

/** A turn that ended: a call still "running" never ran. */
function settle(turn: TurnView): TurnView {
  return { ...turn, approvals: [], tools: turn.tools.map((t) => (t.status === "running" || t.status === "waiting" ? { ...t, status: "not_run" } : t)) };
}
