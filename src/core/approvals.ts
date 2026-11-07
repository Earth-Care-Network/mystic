/**
 * OpenDuet's approval gate, on the desktop.
 *
 * The rule is OpenBot's: a tool Mystic cannot positively classify as a read is a
 * write, and a write pauses with Refuse, Allow once or Always allow. A message
 * to other people always asks, every time, whatever was allowed before.
 */
export type Decision = "allow_once" | "always_allow" | "refuse" | "unattended";

export type ToolClass = "read" | "write" | "outbound";

const READ_PREFIXES = ["get_", "list_", "read_", "search_", "find_", "fetch_", "lookup_", "show_", "count_", "query_"];
const READ_SUFFIXES = ["_read", "_list", "_get", "_search", "_status"];
const OUTBOUND = /(^|_)(send|reply|post|publish|unpublish|email|message|dm|tweet|share|invite|pay|charge|refund|transfer|sign|submit|delete|remove|purge|archive|push|merge|schedule|broadcast|launch|connect|disconnect|cancel|get_email|read_site|read_more|bulk|export|grant|mint|go_live)(_|$)/;

/** Tools Mystic itself ships, with their class written down rather than guessed. */
export const KNOWN: Record<string, ToolClass> = {
  memory_read: "read",
  list_agents: "read",
  read_note: "read",
  memory_write: "write",
  write_note: "write",
  create_agent: "write",
  schedule_task: "write",
  handoff: "read",
};

/**
 * Tools whose effect outlives the turn: what an agent remembers (it enters every later
 * system prompt), a new agent, a routine that runs with nobody there. A tool result can
 * carry instructions, so these ask every time and never join "Always allow".
 */
export const NEVER_ALWAYS = new Set(["memory_write", "create_agent", "schedule_task"]);

/** Mystic's own tools are known only by their bare names; a server's `ecn__handoff` is not Mystic's handoff. */
const builtIn = (tool: string) => (tool.includes("__") || tool.includes("/") ? "" : tool.toLowerCase());

export type Hints = { readOnlyHint?: boolean; destructiveHint?: boolean };

const verb = (text: string) => OUTBOUND.test(text.toLowerCase().replace(/[^a-z0-9]+/g, "_"));

/**
 * One call's class. A mixed tool (ECN's `site`, `crm_records`, `media`, …) is judged by
 * the action it was asked to do, so "Always allow" on a tag never covers a delete.
 */
export function classify(tool: string, hints?: Hints, args?: Record<string, unknown>): ToolClass {
  const own = builtIn(tool);
  if (own && KNOWN[own]) return KNOWN[own];
  const name = tool.toLowerCase().split(/\/|__/).pop() || tool.toLowerCase();
  const action = typeof args?.action === "string" ? args.action : "";
  if (verb(name) || (action && verb(action)) || args?.confirm === true) return "outbound";
  if (hints?.destructiveHint) return "outbound";
  if (hints?.readOnlyHint) return "read";
  const readName = READ_PREFIXES.some((p) => name.startsWith(p)) || READ_SUFFIXES.some((x) => name.endsWith(x));
  const readAction = !action || READ_PREFIXES.some((p) => `${action}_`.startsWith(p)) || /^(get|list|read|search|find|status|preview|guide)$/.test(action);
  // A server's tool is a read only when it says so, or when name and action both read.
  if (readName && readAction) return "read";
  return "write";
}

/** What "Always allow" remembers: the tool and, for a mixed tool, the action. */
export function policyKey(tool: string, args?: Record<string, unknown>): string {
  // The action and every sub-step a mixed tool takes (`community_step`, `record_kind`,
  // `mode`), so allowing one step never allows another.
  const parts = Object.keys(args || {})
    .filter((k) => k === "action" || /(^|_)(step|kind|mode)$/.test(k))
    .sort()
    .map((k) => (typeof args![k] === "string" ? String(args![k]).trim().toLowerCase().slice(0, 60) : ""))
    .filter(Boolean);
  return parts.length ? `${tool}#${parts.join("#")}` : tool;
}

export type Policy = { alwaysAllow: string[] };

/**
 * Whether this call waits for a person. With nobody there (a routine, or an agent it
 * handed to), every call that isn't a read asks, which means it isn't done: "Always
 * allow" was a yes given while the person was watching.
 */
export function needsApproval(tool: string, policy: Policy, hints?: Hints, args?: Record<string, unknown>, unattended = false): boolean {
  const cls = classify(tool, hints, args);
  if (cls === "read") return false;
  if (cls === "outbound" || unattended || NEVER_ALWAYS.has(builtIn(tool))) return true;
  return !policy.alwaysAllow.includes(policyKey(tool, args));
}

/** Whether the card may offer "Always allow" for this call. */
export function canAlwaysAllow(tool: string, hints?: Hints, args?: Record<string, unknown>): boolean {
  return classify(tool, hints, args) === "write" && !NEVER_ALWAYS.has(builtIn(tool));
}

export function applyDecision(policy: Policy, tool: string, decision: Decision, hints?: Hints, args?: Record<string, unknown>): Policy {
  const key = policyKey(tool, args);
  if (decision !== "always_allow" || !canAlwaysAllow(tool, hints, args) || policy.alwaysAllow.includes(key)) return policy;
  return { alwaysAllow: [...policy.alwaysAllow, key] };
}

/** The sentence on the card: what will happen, in words, never raw JSON first. */
export function summarize(tool: string, args: Record<string, unknown>): string {
  const name = tool.split(/\/|__/).pop() || tool;
  const to = args.to ?? args.recipient ?? args.email;
  const subject = args.subject ?? args.title ?? args.name;
  const words = name.replace(/_/g, " ");
  const parts = [words.charAt(0).toUpperCase() + words.slice(1)];
  if (subject) parts.push(`“${String(subject).slice(0, 80)}”`);
  if (to) parts.push(`to ${String(to).slice(0, 80)}`);
  return parts.join(" ");
}
