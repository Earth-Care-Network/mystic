/**
 * A small MCP client (streamable HTTP, JSON-RPC 2.0) for remote servers such as
 * Earth Care Network's own (https://www.earthcare.network/mcp). Agents get the
 * server's tools under `<serverId>/<tool>`, the same ref form OpenDuet grants in.
 */
import type { FetchLike, ToolSpec } from "./providers";

export type McpTool = ToolSpec & { annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean }; mcpName: string };

/** Providers accept function names matching ^[a-zA-Z0-9_-]{1,64}$ (OpenAI) / {1,128} (Anthropic). */
export function providerSafeName(serverId: string, tool: string): string {
  return `${serverId}__${tool}`.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
}

export class McpClient {
  private id = 0;
  private session?: string;
  private ready = false;

  constructor(
    readonly serverId: string,
    readonly url: string,
    private token: () => Promise<string | undefined>,
    private fetchImpl: FetchLike,
  ) {}

  private async rpc(method: string, params?: unknown): Promise<any> {
    const headers: Record<string, string> = { "content-type": "application/json", accept: "application/json, text/event-stream" };
    const t = await this.token();
    if (t) headers.authorization = `Bearer ${t}`;
    if (this.session) headers["mcp-session-id"] = this.session;
    const res = await this.fetchImpl(this.url, {
      method: "POST",
      headers,
      body: JSON.stringify({ jsonrpc: "2.0", id: ++this.id, method, params }),
    });
    const sid = res.headers.get("mcp-session-id");
    if (sid) this.session = sid;
    if (res.status === 401) throw new Error("Sign in to Earth Care Network again in Settings · Earth Care Network.");
    if (!res.ok) throw new Error(`${this.serverId} answered HTTP ${res.status}.`);
    const type = res.headers.get("content-type") || "";
    const text = await res.text();
    let payload: any;
    if (type.includes("text/event-stream")) {
      const line = text.split("\n").reverse().find((l) => l.startsWith("data:"));
      payload = line ? JSON.parse(line.slice(5)) : {};
    } else payload = text ? JSON.parse(text) : {};
    if (payload.error) throw new Error(payload.error.message || "The tool failed.");
    return payload.result;
  }

  async init(): Promise<void> {
    if (this.ready) return;
    await this.rpc("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "Mystic", version: "0.1.0" },
    });
    this.ready = true;
  }

  async listTools(): Promise<McpTool[]> {
    await this.init();
    const result = await this.rpc("tools/list", {});
    return (result?.tools || []).map((t: any) => ({
      name: providerSafeName(this.serverId, String(t.name)),
      mcpName: String(t.name),
      description: String(t.description || "").slice(0, 1024),
      parameters: t.inputSchema || { type: "object", properties: {} },
      annotations: t.annotations,
    }));
  }

  /** Call by the server's own tool name (McpTool.mcpName). */
  async call(mcpName: string, args: Record<string, unknown>): Promise<string> {
    await this.init();
    const result = await this.rpc("tools/call", { name: mcpName, arguments: args });
    const parts = (result?.content || []).map((c: any) => (c.type === "text" ? c.text : JSON.stringify(c)));
    const text = parts.join("\n") || JSON.stringify(result ?? {});
    return result?.isError ? `Error: ${text}` : text;
  }
}
