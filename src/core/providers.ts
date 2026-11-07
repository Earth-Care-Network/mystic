/**
 * Any key in. One streaming chat interface out.
 *
 * Two wire formats cover almost every model a person can bring: the OpenAI chat
 * completions shape (OpenAI, OpenRouter, Ollama, LM Studio, Groq, xAI, Mistral,
 * DeepSeek, Together, Google's OpenAI-compatible Gemini endpoint, any custom
 * base URL) and Anthropic's Messages API. Earth Care Cloud is a third kind, but
 * it runs the whole turn server-side (see ecn.ts), so it is not a chat provider.
 */
import { readSse } from "./sse";

export type ProviderKind = "openai_compat" | "anthropic";

export type ProviderPreset = {
  id: string;
  label: string;
  kind: ProviderKind;
  baseUrl: string;
  needsKey: boolean;
  /** A model to start with; the person can type any other. */
  defaultModel: string;
  keyHint?: string;
  local?: boolean;
};

export const PRESETS: ProviderPreset[] = [
  { id: "openrouter", label: "OpenRouter (every model, one key)", kind: "openai_compat", baseUrl: "https://openrouter.ai/api/v1", needsKey: true, defaultModel: "anthropic/claude-sonnet-5.5", keyHint: "sk-or-…" },
  { id: "anthropic", label: "Anthropic", kind: "anthropic", baseUrl: "https://api.anthropic.com", needsKey: true, defaultModel: "claude-sonnet-5-5", keyHint: "sk-ant-…" },
  { id: "openai", label: "OpenAI", kind: "openai_compat", baseUrl: "https://api.openai.com/v1", needsKey: true, defaultModel: "gpt-5.6-terra", keyHint: "sk-…" },
  { id: "google", label: "Google Gemini", kind: "openai_compat", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", needsKey: true, defaultModel: "gemini-3-pro" },
  { id: "xai", label: "xAI Grok", kind: "openai_compat", baseUrl: "https://api.x.ai/v1", needsKey: true, defaultModel: "grok-5" },
  { id: "groq", label: "Groq", kind: "openai_compat", baseUrl: "https://api.groq.com/openai/v1", needsKey: true, defaultModel: "llama-4-maverick" },
  { id: "mistral", label: "Mistral", kind: "openai_compat", baseUrl: "https://api.mistral.ai/v1", needsKey: true, defaultModel: "mistral-large-latest" },
  { id: "deepseek", label: "DeepSeek", kind: "openai_compat", baseUrl: "https://api.deepseek.com/v1", needsKey: true, defaultModel: "deepseek-chat" },
  { id: "ollama", label: "Ollama (on this Mac)", kind: "openai_compat", baseUrl: "http://127.0.0.1:11434/v1", needsKey: false, defaultModel: "llama3.3", local: true },
  { id: "lmstudio", label: "LM Studio (on this Mac)", kind: "openai_compat", baseUrl: "http://127.0.0.1:1234/v1", needsKey: false, defaultModel: "local-model", local: true },
  { id: "custom", label: "Any OpenAI-compatible endpoint", kind: "openai_compat", baseUrl: "", needsKey: false, defaultModel: "" },
];

export function preset(id: string): ProviderPreset | undefined {
  return PRESETS.find((p) => p.id === id);
}

/** A provider the person set up: a preset (or custom URL) plus their key from the keychain. */
export type ProviderConfig = {
  id: string;
  kind: ProviderKind;
  baseUrl: string;
  apiKey?: string;
};

export type ToolCall = { id: string; name: string; arguments: string };

export type ChatMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; toolCalls?: ToolCall[] }
  | { role: "tool"; toolCallId: string; name: string; content: string };

export type ToolSpec = { name: string; description: string; parameters: Record<string, unknown> };

export type StreamPart =
  | { type: "text"; delta: string }
  | { type: "tool_call_start"; index: number; id: string; name: string }
  | { type: "tool_call_args"; index: number; delta: string }
  | { type: "done"; reason: string };

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export type ChatRequest = {
  provider: ProviderConfig;
  model: string;
  messages: ChatMessage[];
  tools?: ToolSpec[];
  signal?: AbortSignal;
  maxTokens?: number;
};

export class ProviderError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
  }
}

/** One plain sentence for the person, from a provider's HTTP refusal. */
export function explainStatus(status: number, providerLabel: string): string {
  if (status === 401 || status === 403) return `${providerLabel} didn't accept that key. Check it in Settings · Models.`;
  if (status === 402) return `${providerLabel} says the account is out of credit.`;
  if (status === 404) return `${providerLabel} doesn't know that model. Pick another in the agent's settings.`;
  if (status === 429) return `${providerLabel} is rate-limiting this key. Try again in a minute.`;
  if (status >= 500) return `${providerLabel} is having trouble right now. Try again shortly.`;
  return `${providerLabel} refused the request (HTTP ${status}).`;
}

// ---- OpenAI-compatible -------------------------------------------------------

export function openaiBody(req: ChatRequest): Record<string, unknown> {
  const messages = req.messages.map((m) => {
    if (m.role === "tool") return { role: "tool", tool_call_id: m.toolCallId, content: m.content };
    if (m.role === "assistant" && !m.content && !m.toolCalls?.length) return null;
    if (m.role === "assistant" && m.toolCalls?.length)
      return {
        role: "assistant",
        content: m.content || null,
        tool_calls: m.toolCalls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: c.arguments || "{}" } })),
      };
    return { role: m.role, content: m.content };
  }).filter(Boolean);
  const body: Record<string, unknown> = { model: req.model, messages, stream: true };
  if (req.maxTokens) body.max_tokens = req.maxTokens;
  if (req.tools?.length)
    body.tools = req.tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } }));
  return body;
}

export function* openaiParts(json: any): Generator<StreamPart> {
  const choice = json?.choices?.[0];
  if (!choice) return;
  const delta = choice.delta || {};
  if (typeof delta.content === "string" && delta.content) yield { type: "text", delta: delta.content };
  const parts: StreamPart[] = [];
  const list: any[] = delta.tool_calls || [];
  list.forEach((tc, position) => {
    // Gemini's OpenAI-compatible endpoint omits `index` and sends each call whole.
    const index = typeof tc.index === "number" ? tc.index : position;
    if (tc.id || tc.function?.name) parts.push({ type: "tool_call_start", index, id: tc.id || `call_${index}`, name: tc.function?.name || "" });
    if (tc.function?.arguments) parts.push({ type: "tool_call_args", index, delta: tc.function.arguments });
  });
  yield* parts;
  if (choice.finish_reason) yield { type: "done", reason: choice.finish_reason };
}

// ---- Anthropic ----------------------------------------------------------------

export function anthropicBody(req: ChatRequest): Record<string, unknown> {
  const system = req.messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
  const messages: any[] = [];
  for (const m of req.messages) {
    if (m.role === "system") continue;
    if (m.role === "tool") {
      const block = { type: "tool_result", tool_use_id: m.toolCallId, content: m.content };
      const last = messages[messages.length - 1];
      if (last?.role === "user" && Array.isArray(last.content) && last.content[0]?.type === "tool_result") last.content.push(block);
      else messages.push({ role: "user", content: [block] });
      continue;
    }
    if (m.role === "assistant") {
      const content: any[] = [];
      if (m.content) content.push({ type: "text", text: m.content });
      for (const c of m.toolCalls || []) content.push({ type: "tool_use", id: c.id, name: c.name, input: safeJson(c.arguments) });
      // Anthropic refuses an empty assistant turn anywhere but last.
      if (content.length) messages.push({ role: "assistant", content });
      continue;
    }
    messages.push({ role: "user", content: m.content });
  }
  const body: Record<string, unknown> = { model: req.model, max_tokens: req.maxTokens || 4096, messages, stream: true };
  if (system) body.system = system;
  if (req.tools?.length) body.tools = req.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters }));
  return body;
}

export function* anthropicParts(event: string, json: any): Generator<StreamPart> {
  if (event === "content_block_start" && json?.content_block?.type === "tool_use")
    yield { type: "tool_call_start", index: json.index, id: json.content_block.id, name: json.content_block.name };
  else if (event === "content_block_delta") {
    const d = json?.delta || {};
    if (d.type === "text_delta" && d.text) yield { type: "text", delta: d.text };
    if (d.type === "input_json_delta" && d.partial_json) yield { type: "tool_call_args", index: json.index, delta: d.partial_json };
  } else if (event === "message_delta" && json?.delta?.stop_reason) yield { type: "done", reason: json.delta.stop_reason };
}

export function safeJson(text: string): Record<string, unknown> {
  try {
    const v = JSON.parse(text || "{}");
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

// ---- One door ----------------------------------------------------------------

export async function* streamChat(req: ChatRequest, fetchImpl: FetchLike): AsyncGenerator<StreamPart> {
  const { provider } = req;
  const label = preset(provider.id)?.label || provider.baseUrl;
  const base = provider.baseUrl.replace(/\/+$/, "");
  const anthropic = provider.kind === "anthropic";
  const url = anthropic ? `${base}/v1/messages` : `${base}/chat/completions`;
  const headers: Record<string, string> = { "content-type": "application/json", accept: "text/event-stream" };
  if (anthropic) {
    headers["anthropic-version"] = "2023-06-01";
    if (provider.apiKey) headers["x-api-key"] = provider.apiKey;
  } else if (provider.apiKey) headers.authorization = `Bearer ${provider.apiKey}`;
  if (provider.id === "openrouter") {
    headers["HTTP-Referer"] = "https://www.earthcare.network/mystic";
    headers["X-Title"] = "Mystic by Earth Care Network";
  }
  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: "POST",
      headers,
      body: JSON.stringify(anthropic ? anthropicBody(req) : openaiBody(req)),
      signal: req.signal,
    });
  } catch (err) {
    if ((err as Error)?.name === "AbortError") throw err;
    throw new ProviderError(
      preset(provider.id)?.local ? `${label} isn't answering. Is it running?` : `Couldn't reach ${label}. Check your connection.`,
    );
  }
  if (!res.ok || !res.body) throw new ProviderError(explainStatus(res.status, label), res.status);
  for await (const msg of readSse(res.body)) {
    if (msg.data === "[DONE]") break;
    const json = safeJsonAny(msg.data);
    if (json?.error) throw new ProviderError(String(json.error.message || json.error));
    if (anthropic) yield* anthropicParts(msg.event === "message" ? json?.type : msg.event, json);
    else yield* openaiParts(json);
  }
}

function safeJsonAny(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
