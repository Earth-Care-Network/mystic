/**
 * Mystic's state and the work it runs, over the platform bridge.
 *
 * ~/Mystic/
 *   settings.json          providers (no keys), default model, approvals, cloud
 *   agents/<id>.json       each agent: instructions, model, memory
 *   chats/<id>.json        each agent's conversation
 *   notes/<name>.md        what agents write for the person
 *   routines.json          scheduled work
 *   openduet/*.yaml        the team as an OpenDuet tenant package (Export)
 * Keys and the Earth Care Network sign-in live in the OS keychain, never here.
 */
import { emptyTurn, reduce, type AguiEvent, type ApprovalRequest, type ToolCallView, type TurnView } from "./core/agui";
import { chiefOfStaff, DEFAULT_SKILLS, tenantPackage, type Agent, type ModelChoice } from "./core/agents";
import type { Decision, Policy } from "./core/approvals";
import * as ecn from "./core/ecn";
import { runLocalTurn } from "./core/loop";
import { McpClient } from "./core/mcp";
import { preset, type ChatMessage, type ProviderConfig, type ProviderKind } from "./core/providers";
import { trimHistory } from "./core/history";
import { nextRun } from "./core/schedule";
import { BUILTIN_TOOLS, type Routine, type ToolContext, type ToolHandler } from "./core/tools";
import { folder, httpFetch, listenForSignIn, notify, openUrl, secrets } from "./platform";

export type ProviderSetup = { id: string; kind: ProviderKind; baseUrl: string; label: string; hasKey: boolean; defaultModel?: string };

export type Settings = {
  providers: ProviderSetup[];
  defaultModel: ModelChoice;
  policy: Policy;
  ecn: { origin: string; clientId?: string; enterpriseId?: string; toolsForAgents: boolean };
};

export type LogEntry = { id: string; role: "user" | "assistant"; text: string; tools?: ToolCallView[]; error?: string; at: string; via?: string };
export type Chat = { history: ChatMessage[]; log: LogEntry[]; ecnThreadId?: string };

/** Providers cap a request at 128 tools (OpenAI, xAI, OpenRouter on those). */
export const MAX_TOOLS = 128;

type Ask = (req: ApprovalRequest) => Promise<Decision>;

export const DEFAULT_SETTINGS: Settings = {
  providers: [],
  defaultModel: { providerId: "openrouter", model: "anthropic/claude-sonnet-5.5" },
  policy: { alwaysAllow: [] },
  ecn: { origin: ecn.ECN_ORIGINS.production, toolsForAgents: true },
};

const TOKENS = "ecn.tokens";
const keyName = (providerId: string) => `provider.${providerId}`;
const now = () => new Date().toISOString();
let n = 0;
const id = (p: string) => `${p}-${Date.now().toString(36)}${(n++).toString(36)}`;

type Listener = () => void;

export class Engine {
  settings: Settings = DEFAULT_SETTINGS;
  agents: Agent[] = [];
  chats = new Map<string, Chat>();
  routines: Routine[] = [];
  me: ecn.Me | { off: true } | null = null;
  live = new Map<string, { turn: TurnView; abort: AbortController }>();
  /** Approvals waiting on the person, by request id, with the agent whose chat shows them. */
  pending = new Map<string, { agentId: string; resolve: (d: Decision) => void }>();
  /** Agents in a turn right now (watched or quiet): one turn per agent at a time. */
  busy = new Set<string>();
  ecnToolsNote = "";
  private listeners = new Set<Listener>();
  private ecnTools: ToolHandler[] | null = null;
  private refreshing: Promise<string | undefined> | null = null;
  private routinesRunning = false;
  private timer?: ReturnType<typeof setInterval>;

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit() {
    for (const fn of this.listeners) fn();
  }

  // ---- load / save -----------------------------------------------------------

  async load(): Promise<void> {
    this.settings = { ...DEFAULT_SETTINGS, ...(await folder.readJson<Partial<Settings>>("settings.json", {})) };
    this.settings.ecn = { ...DEFAULT_SETTINGS.ecn, ...this.settings.ecn };
    const files = await folder.list("agents");
    const loaded = await Promise.all(files.filter((f) => f.endsWith(".json")).map((f) => folder.readJson<Agent | null>(`agents/${f}`, null)));
    this.agents = loaded.filter((a): a is Agent => !!a && typeof a.id === "string");
    if (!this.agents.some((a) => a.builtIn)) {
      const cos = chiefOfStaff(this.settings.defaultModel);
      this.agents.unshift(cos);
      await this.saveAgent(cos);
    }
    this.agents.sort((a, b) => Number(!!b.builtIn) - Number(!!a.builtIn) || a.createdAt.localeCompare(b.createdAt));
    this.routines = await folder.readJson<Routine[]>("routines.json", []);
    this.emit();
    void this.refreshMe();
    this.timer ??= setInterval(() => void this.runDueRoutines(), 60_000);
  }

  async saveSettings(patch: Partial<Settings>): Promise<void> {
    this.settings = { ...this.settings, ...patch };
    await folder.writeJson("settings.json", this.settings);
    this.emit();
  }

  async saveAgent(agent: Agent): Promise<void> {
    const i = this.agents.findIndex((a) => a.id === agent.id);
    if (i === -1) this.agents.push(agent);
    else this.agents[i] = agent;
    await folder.writeJson(`agents/${agent.id}.json`, agent);
    this.emit();
  }

  async deleteAgent(agentId: string): Promise<void> {
    const a = this.agents.find((x) => x.id === agentId);
    if (!a || a.builtIn) return;
    this.agents = this.agents.filter((x) => x.id !== agentId);
    await folder.remove(`agents/${agentId}.json`);
    this.emit();
  }

  async chat(agentId: string): Promise<Chat> {
    let c = this.chats.get(agentId);
    if (!c) {
      c = await folder.readJson<Chat>(`chats/${agentId}.json`, { history: [], log: [] });
      this.chats.set(agentId, c);
    }
    return c;
  }

  private async saveChat(agentId: string) {
    const c = this.chats.get(agentId);
    if (c) await folder.writeJson(`chats/${agentId}.json`, { history: trimHistory(c.history), log: c.log.slice(-400), ecnThreadId: c.ecnThreadId });
  }

  async clearChat(agentId: string) {
    this.chats.set(agentId, { history: [], log: [] });
    await this.saveChat(agentId);
    this.emit();
  }

  // ---- providers -------------------------------------------------------------

  async addProvider(p: { id: string; baseUrl?: string; label?: string; key?: string; model?: string }): Promise<ProviderSetup> {
    const base = preset(p.id);
    const setupId = p.id === "custom" ? `custom-${Date.now().toString(36)}` : p.id;
    const setup: ProviderSetup = {
      id: setupId,
      kind: base?.kind || "openai_compat",
      baseUrl: (p.baseUrl || base?.baseUrl || "").trim(),
      label: p.label || base?.label || p.baseUrl || setupId,
      hasKey: !!p.key,
      defaultModel: (p.model || base?.defaultModel || "").trim() || undefined,
    };
    if (p.key) await secrets.set(keyName(setupId), p.key.trim());
    const providers = [...this.settings.providers.filter((x) => x.id !== setupId), setup];
    await this.saveSettings({ providers });
    await this.repairModels();
    return setup;
  }

  /** The model to start an agent on with this provider: what the person typed, else the preset's. */
  modelFor(providerId: string): string {
    const setup = this.settings.providers.find((p) => p.id === providerId);
    return setup?.defaultModel || preset(setup?.id || providerId)?.defaultModel || "";
  }

  async removeProvider(providerId: string): Promise<void> {
    await secrets.delete(keyName(providerId));
    await this.saveSettings({ providers: this.settings.providers.filter((x) => x.id !== providerId) });
    await this.repairModels();
  }

  /** A model this agent can actually run on: a set-up provider, or Earth Care Cloud on Pro. */
  canRun(model: ModelChoice): boolean {
    if (model.providerId === "ecn-cloud") return !!this.cloudEnterprise()?.cloud;
    return !!model.model && this.settings.providers.some((p) => p.id === model.providerId);
  }

  /** Mystic can do something: there is a key, or an enterprise on Pro for the cloud. */
  hasUsableModel(): boolean {
    return this.settings.providers.length > 0 || !!this.cloudChoices().length;
  }

  private cloudChoices(): ecn.Enterprise[] {
    return this.me && !("off" in this.me) ? this.me.enterprises.filter((e) => e.cloud) : [];
  }

  /** Move agents whose model can't run to one that can (the first key, else the cloud). */
  async repairModels(): Promise<void> {
    const first = this.settings.providers[0];
    const fallback: ModelChoice | null = first
      ? { providerId: first.id, model: this.modelFor(first.id) }
      : this.cloudChoices().length
        ? { providerId: "ecn-cloud", model: "jaguar" }
        : null;
    if (!fallback) return;
    if (!this.canRun(this.settings.defaultModel)) await this.saveSettings({ defaultModel: fallback });
    for (const a of this.agents) if (!this.canRun(a.model)) await this.saveAgent({ ...a, model: fallback });
  }

  private async providerConfig(providerId: string): Promise<ProviderConfig> {
    const setup = this.settings.providers.find((p) => p.id === providerId);
    if (!setup) throw new Error("That agent's model provider isn't set up. Add it in Settings · Models.");
    return { id: setup.id, kind: setup.kind, baseUrl: setup.baseUrl, apiKey: await secrets.get(keyName(setup.id)) };
  }

  // ---- Earth Care Network ----------------------------------------------------

  private async tokens(): Promise<ecn.Tokens | null> {
    const raw = await secrets.get(TOKENS);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as ecn.Tokens;
    } catch {
      return null;
    }
  }

  /** A live access token, refreshed when it is about to end. */
  async accessToken(): Promise<string | undefined> {
    const t = await this.tokens();
    if (!t) return undefined;
    if (t.expires_at > Date.now() + 30_000) return t.access_token;
    if (!t.refresh_token || !this.settings.ecn.clientId) return undefined;
    // ECN rotates refresh tokens: one refresh at a time, or the second spends a dead token.
    this.refreshing ??= (async () => {
      try {
        const meta = await ecn.discover(this.settings.ecn.origin, httpFetch);
        const fresh = await ecn.refresh(meta, this.settings.ecn.clientId!, t.refresh_token!, httpFetch);
        await secrets.set(TOKENS, JSON.stringify(fresh));
        return fresh.access_token;
      } finally {
        this.refreshing = null;
      }
    })();
    return this.refreshing;
  }

  /** Point Mystic at another Earth Care Network server: the old sign-in never travels there. */
  async setOrigin(origin: string): Promise<void> {
    if (origin === this.settings.ecn.origin) return;
    await secrets.delete(TOKENS);
    this.me = null;
    this.ecnTools = null;
    await this.saveSettings({ ecn: { ...this.settings.ecn, origin, clientId: undefined, enterpriseId: undefined } });
  }

  async signIn(): Promise<void> {
    const origin = this.settings.ecn.origin;
    const meta = await ecn.discover(origin, httpFetch);
    const clientId = this.settings.ecn.clientId || (await ecn.register(meta, httpFetch));
    if (clientId !== this.settings.ecn.clientId) await this.saveSettings({ ecn: { ...this.settings.ecn, clientId } });
    const { verifier, challenge } = await ecn.pkcePair();
    const state = ecn.randomState();
    const { port, callback } = await listenForSignIn(state);
    await openUrl(ecn.authorizeUrl(meta, { clientId, port, challenge, state }));
    const cb = await callback;
    if (cb.error || !cb.code)
      throw new Error(cb.error === "access_denied" ? "Sign-in was cancelled." : cb.error === "timeout" ? "Sign-in timed out. Try again." : "Sign-in didn't finish. Try again.");
    if (cb.state !== state) throw new Error("That sign-in didn't come from this window. Try again.");
    const tokens = await ecn.exchangeCode(meta, { clientId, code: cb.code, verifier, port }, httpFetch);
    await secrets.set(TOKENS, JSON.stringify(tokens));
    this.ecnTools = null;
    await this.refreshMe();
    await this.repairModels();
  }

  async signOut(): Promise<void> {
    await secrets.delete(TOKENS);
    this.me = null;
    this.ecnTools = null;
    await this.saveSettings({ ecn: { ...this.settings.ecn, enterpriseId: undefined } });
    await this.repairModels();
  }

  async refreshMe(): Promise<void> {
    try {
      const token = await this.accessToken();
      this.me = token ? await ecn.me(this.settings.ecn.origin, token, httpFetch) : null;
      if (this.me && !("off" in this.me) && !this.settings.ecn.enterpriseId) {
        const first = this.me.enterprises.find((e) => e.cloud);
        if (first) await this.saveSettings({ ecn: { ...this.settings.ecn, enterpriseId: first.organization_id } });
      }
    } catch {
      this.me = null;
    }
    this.emit();
  }

  cloudEnterprise(): ecn.Enterprise | undefined {
    if (!this.me || "off" in this.me) return undefined;
    return this.me.enterprises.find((e) => e.organization_id === this.settings.ecn.enterpriseId);
  }

  /** Earth Care Network's MCP tools, for local agents, once signed in. A failure is not cached. */
  private async ecnToolHandlers(room: number): Promise<ToolHandler[]> {
    if (!this.settings.ecn.toolsForAgents || !(await this.tokens())) return [];
    if (!this.ecnTools) {
      try {
        const client = new McpClient("ecn", ecn.mcpUrl(this.settings.ecn.origin), () => this.accessToken(), httpFetch);
        const tools = await client.listTools();
        this.ecnTools = tools.map((t) => ({
          spec: { name: t.name, description: t.description, parameters: t.parameters },
          annotations: t.annotations,
          run: (args) => client.call(t.mcpName, args),
        }));
        this.ecnToolsNote = "";
      } catch (err) {
        this.ecnToolsNote = `Earth Care Network tools aren't available right now: ${(err as Error).message}`;
        this.emit();
        return [];
      }
    }
    if (this.ecnTools.length <= room) return this.ecnTools;
    // Over the cap: reads first (they never ask), then the rest, and say what was left out.
    const reads = this.ecnTools.filter((h) => h.annotations?.readOnlyHint);
    const rest = this.ecnTools.filter((h) => !h.annotations?.readOnlyHint);
    const chosen = [...reads, ...rest].slice(0, room);
    this.ecnToolsNote = `Your agents have ${chosen.length} of Earth Care Network's ${this.ecnTools.length} tools (providers take ${MAX_TOOLS} at most).`;
    return chosen;
  }

  // ---- turns -----------------------------------------------------------------

  decide(requestId: string, decision: Decision) {
    const p = this.pending.get(requestId);
    if (!p) return;
    this.pending.delete(requestId);
    const slot = this.live.get(p.agentId);
    if (slot) slot.turn = { ...slot.turn, approvals: slot.turn.approvals.filter((a) => a.id !== requestId) };
    p.resolve(decision);
    this.emit();
  }

  /** Stop this agent's turn only: its own approvals are refused, nobody else's. */
  stop(agentId: string) {
    this.live.get(agentId)?.abort.abort();
    for (const [rid, p] of [...this.pending]) {
      if (p.agentId !== agentId) continue;
      this.pending.delete(rid);
      p.resolve("refuse");
    }
    this.emit();
  }

  private ctxFor(agent: Agent, depth: number, ask: Ask, signal: AbortSignal, chain: string[]): ToolContext {
    return {
      agent,
      depth,
      chain,
      agents: () => this.agents,
      saveAgent: (a) => this.saveAgent(a),
      readNote: (name) => folder.read(`notes/${name.replace(/\.md$/, "")}.md`),
      writeNote: (name, text) => folder.write(`notes/${name.replace(/\.md$/, "")}.md`, text),
      addRoutine: async (r) => {
        this.routines.push(r);
        await folder.writeJson("routines.json", this.routines);
        this.emit();
      },
      runAgent: (agentId, task, d) => this.runQuiet(agentId, task, d, `handoff from ${agent.name}`, ask, signal, [...chain, agentId]),
      defaultModel: () => this.settings.defaultModel,
      now: () => new Date(),
    };
  }

  private async *events(agent: Agent, chat: Chat, signal: AbortSignal, depth: number, ask: Ask, chain: string[]): AsyncGenerator<AguiEvent> {
    const threadId = `mystic-${agent.id}`;
    const runId = id("run");
    if (agent.model.providerId === "ecn-cloud") {
      const ent = this.cloudEnterprise();
      const token = await this.accessToken();
      if (!token) return yield { type: "RUN_ERROR", message: "Sign in to Earth Care Network in Settings · Earth Care Network to use Earth Care Cloud.", code: "signed_out" };
      if (!ent?.cloud) return yield { type: "RUN_ERROR", message: "Earth Care Cloud runs on an enterprise with Pro. Pick one in Settings · Earth Care Network, or give this agent your own key.", code: "mystic_cloud_requires_pro" };
      const messages = chat.history
        .filter((m): m is Extract<ChatMessage, { role: "user" | "assistant" }> => (m.role === "user" || m.role === "assistant") && !!m.content)
        .slice(-30)
        .map((m) => ({ id: id("m"), role: m.role, content: m.content }));
      let turn = emptyTurn(runId);
      for await (const e of ecn.cloudRun(this.settings.ecn.origin, token, { threadId, runId, organizationId: ent.organization_id, ecnThreadId: chat.ecnThreadId, messages }, httpFetch, signal)) {
        turn = reduce(turn, e);
        yield e;
      }
      if (turn.threadId) chat.ecnThreadId = turn.threadId;
      // What Jaguar settled on (after its honesty pass), never the raw stream.
      if (turn.text) chat.history.push({ role: "assistant", content: turn.text });
      return;
    }
    const provider = await this.providerConfig(agent.model.providerId);
    const tools = [...BUILTIN_TOOLS, ...(await this.ecnToolHandlers(MAX_TOOLS - BUILTIN_TOOLS.length))];
    yield* runLocalTurn({
      agent,
      team: this.agents,
      history: chat.history,
      provider,
      tools,
      ctx: this.ctxFor(agent, depth, ask, signal, chain),
      policy: this.settings.policy,
      onPolicy: (policy) => void this.saveSettings({ policy }),
      askApproval: ask,
      fetchImpl: httpFetch,
      signal,
      threadId,
      runId,
    });
  }

  /** A turn the person is watching in the chat. */
  async send(agentId: string, text: string): Promise<void> {
    const agent = this.agents.find((a) => a.id === agentId);
    if (!agent || this.busy.has(agentId)) return;
    this.busy.add(agentId);
    const chat = await this.chat(agentId);
    chat.history.push({ role: "user", content: text });
    chat.log.push({ id: id("u"), role: "user", text, at: now() });
    const abort = new AbortController();
    const slot = { turn: emptyTurn(), abort };
    this.live.set(agentId, slot);
    this.emit();
    // Every approval in this request, the handed-off agents' included, shows in this chat.
    const ask: Ask = (req) =>
      new Promise<Decision>((resolve) => {
        if (abort.signal.aborted) return resolve("refuse");
        if (!slot.turn.approvals.some((a) => a.id === req.id)) slot.turn = { ...slot.turn, approvals: [...slot.turn.approvals, req] };
        this.pending.set(req.id, { agentId, resolve });
        this.emit();
      });
    try {
      for await (const e of this.events(agent, chat, abort.signal, 0, ask, [agentId])) {
        if (e.type === "CUSTOM" && e.name === "approval_request" && slot.turn.approvals.some((a) => a.id === (e.value as ApprovalRequest).id)) continue;
        slot.turn = reduce(slot.turn, e);
        this.emit();
      }
    } catch (err) {
      slot.turn = { ...slot.turn, error: { message: (err as Error).message }, finished: true };
    } finally {
      this.live.delete(agentId);
      this.busy.delete(agentId);
    }
    const t = slot.turn;
    chat.log.push({ id: id("a"), role: "assistant", text: t.text, tools: t.tools, error: t.error?.message, at: now(), via: agent.model.providerId === "ecn-cloud" ? "Earth Care Cloud" : undefined });
    await this.saveChat(agentId);
    this.emit();
  }

  /**
   * A turn nobody types into: a handoff (its approvals go to the chat that asked) or a
   * routine (nobody is there, so a write is not done and the agent says it needs a yes).
   */
  private async runQuiet(agentId: string, task: string, depth: number, via: string, ask: Ask, signal: AbortSignal, chain: string[]): Promise<string> {
    const agent = this.agents.find((a) => a.id === agentId);
    if (!agent) return `Error: there is no agent ${agentId}.`;
    if (this.busy.has(agentId)) return `Error: ${agent.name} is busy with another task. Try again in a moment, or do this part yourself.`;
    this.busy.add(agentId);
    this.emit();
    try {
      const chat = await this.chat(agentId);
      chat.history.push({ role: "user", content: task });
      chat.log.push({ id: id("u"), role: "user", text: task, at: now(), via });
      let turn = emptyTurn();
      for await (const e of this.events(agent, chat, signal, depth, ask, chain)) turn = reduce(turn, e);
      const answer = turn.error ? `Error: ${turn.error.message}` : turn.text;
      chat.log.push({ id: id("a"), role: "assistant", text: turn.text, tools: turn.tools, error: turn.error?.message, at: now(), via });
      await this.saveChat(agentId);
      return answer;
    } finally {
      this.busy.delete(agentId);
      this.emit();
    }
  }

  async runDueRoutines(): Promise<void> {
    if (this.routinesRunning) return;
    const due = this.routines.filter((r) => new Date(r.nextAt) <= new Date());
    if (!due.length) return;
    this.routinesRunning = true;
    try {
      // Advance every due routine before running any, so none runs twice.
      for (const r of due) r.nextAt = nextRun(r.schedule, new Date()).toISOString();
      await folder.writeJson("routines.json", this.routines);
      const unattended: Ask = async () => "unattended";
      for (const r of due) {
        const answer = await this.runQuiet(r.agentId, r.task, 1, `routine · ${r.label}`, unattended, new AbortController().signal, [r.agentId]);
        const agent = this.agents.find((a) => a.id === r.agentId);
        void notify(agent?.name || "Mystic", answer.slice(0, 180));
      }
    } finally {
      this.routinesRunning = false;
      this.emit();
    }
  }

  async deleteRoutine(routineId: string) {
    this.routines = this.routines.filter((r) => r.id !== routineId);
    await folder.writeJson("routines.json", this.routines);
    this.emit();
  }

  /** Write the team as an OpenDuet tenant package into ~/Mystic/openduet. */
  async exportOpenDuet(): Promise<string[]> {
    const pkg = tenantPackage(this.agents, DEFAULT_SKILLS, (pid) => {
      const kind = this.settings.providers.find((p) => p.id === pid)?.kind;
      return kind === "anthropic" ? "anthropic" : "openai";
    });
    for (const [name, text] of Object.entries(pkg)) await folder.write(`openduet/${name}`, text);
    return Object.keys(pkg);
  }
}

export const engine = new Engine();
