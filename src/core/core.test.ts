import { describe, expect, test } from "bun:test";
import * as mdMod from "./markdown";
import * as approvalsMod from "./approvals";
import * as ecnMod from "./ecn";
import { emptyTurn, reduce, type AguiEvent } from "./agui";
import { chiefOfStaff, newAgent, tenantPackage, uniqueId } from "./agents";
import { applyDecision, classify, needsApproval } from "./approvals";
import { authorizeUrl, pkcePair } from "./ecn";
import { finalAnswer, runLocalTurn } from "./loop";
import { anthropicBody, openaiBody, openaiParts, streamChat, type ChatMessage } from "./providers";
import { describe as describeSchedule, nextRun, parseSchedule } from "./schedule";
import { SseParser } from "./sse";
import { BUILTIN_TOOLS, type Routine, type ToolContext } from "./tools";

const sse = (chunks: string[]) =>
  new Response(new ReadableStream({ start(c) { for (const x of chunks) c.enqueue(new TextEncoder().encode(x)); c.close(); } }), {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
const oai = (o: unknown) => `data: ${JSON.stringify(o)}\n\n`;

describe("sse", () => {
  test("splits across chunk boundaries and joins multi-line data", () => {
    const p = new SseParser();
    expect(p.push("event: a\ndata: 1\n")).toEqual([]);
    expect(p.push("data: 2\n\ndata: x\r\n\r\n")).toEqual([{ event: "a", data: "1\n2" }, { event: "message", data: "x" }]);
  });
});

describe("providers", () => {
  test("openai stream parts carry text and tool call fragments", () => {
    const parts = [...openaiParts({ choices: [{ delta: { tool_calls: [{ index: 0, id: "c1", function: { name: "memory_write", arguments: '{"fa' } }] } }] })];
    expect(parts).toEqual([
      { type: "tool_call_start", index: 0, id: "c1", name: "memory_write" },
      { type: "tool_call_args", index: 0, delta: '{"fa' },
    ]);
  });

  test("anthropic body lifts the system prompt and groups tool results in one user turn", () => {
    const msgs: ChatMessage[] = [
      { role: "system", content: "be kind" },
      { role: "user", content: "hi" },
      { role: "assistant", content: "", toolCalls: [{ id: "a", name: "x", arguments: "{}" }, { id: "b", name: "y", arguments: '{"q":1}' }] },
      { role: "tool", toolCallId: "a", name: "x", content: "1" },
      { role: "tool", toolCallId: "b", name: "y", content: "2" },
    ];
    const body = anthropicBody({ provider: { id: "anthropic", kind: "anthropic", baseUrl: "" }, model: "m", messages: msgs }) as any;
    expect(body.system).toBe("be kind");
    expect(body.messages).toHaveLength(3);
    expect(body.messages[2].content.map((c: any) => c.tool_use_id)).toEqual(["a", "b"]);
    expect(body.messages[1].content[1].input).toEqual({ q: 1 });
  });

  test("openai body sends the key-free shape for a local model", () => {
    const body = openaiBody({ provider: { id: "ollama", kind: "openai_compat", baseUrl: "" }, model: "llama3.3", messages: [{ role: "user", content: "hi" }] }) as any;
    expect(body).toEqual({ model: "llama3.3", messages: [{ role: "user", content: "hi" }], stream: true });
  });

  test("a refused key becomes one sentence naming where to fix it", async () => {
    const gen = streamChat(
      { provider: { id: "openai", kind: "openai_compat", baseUrl: "https://api.openai.com/v1", apiKey: "bad" }, model: "m", messages: [] },
      async () => new Response("{}", { status: 401 }),
    );
    await expect(gen.next()).rejects.toThrow("didn't accept that key");
  });
});

describe("approvals", () => {
  test("anything not positively a read is a write, and messages always ask", () => {
    expect(classify("ecn/list_contacts")).toBe("read");
    expect(classify("ecn/create_contact")).toBe("write");
    expect(classify("gmail_send_reply")).toBe("outbound");
    expect(classify("mystery", { readOnlyHint: true })).toBe("read");
    let policy = { alwaysAllow: [] as string[] };
    policy = applyDecision(policy, "ecn/create_contact", "always_allow");
    expect(needsApproval("ecn/create_contact", policy)).toBe(false);
    policy = applyDecision(policy, "gmail_send_reply", "always_allow");
    expect(needsApproval("gmail_send_reply", policy)).toBe(true);
  });
});

describe("schedule", () => {
  test("reads plain words", () => {
    expect(parseSchedule("every weekday at 8am")).toEqual({ kind: "daily", hour: 8, minute: 0, days: [1, 2, 3, 4, 5] });
    expect(parseSchedule("daily at 7:30 pm")).toMatchObject({ hour: 19, minute: 30, days: [0, 1, 2, 3, 4, 5, 6] });
    expect(parseSchedule("mondays at 9")).toMatchObject({ days: [1], hour: 9 });
    expect(parseSchedule("every 5 minutes")).toEqual({ kind: "interval", minutes: 15 });
    expect(parseSchedule("whenever")).toBeNull();
  });

  test("next run skips the weekend", () => {
    const s = parseSchedule("every weekday at 8am")!;
    const friday9 = new Date(2026, 10, 6, 9, 0); // Fri 6 Nov 2026
    const next = nextRun(s, friday9);
    expect(next.getDay()).toBe(1);
    expect(next.getHours()).toBe(8);
    expect(describeSchedule(s)).toBe("Weekdays at 8 am");
  });
});

describe("agents", () => {
  test("ids stay unique and the team exports as an OpenDuet tenant package", () => {
    expect(uniqueId("Outreach", ["outreach"])).toBe("outreach-2");
    const cos = chiefOfStaff({ providerId: "openrouter", model: "anthropic/claude-sonnet-5.5" });
    const writer = newAgent({ name: "Launch writer", instructions: "Write launch copy.", model: cos.model }, [cos.id]);
    const pkg = tenantPackage([cos, writer], [], () => "openai");
    expect(Object.keys(pkg).sort()).toEqual(["agents.yaml", "brand.yaml", "channels.yaml", "model.yaml", "skills.yaml"]);
    expect(pkg["brand.yaml"]).toContain("product_name: Mystic");
    expect(pkg["agents.yaml"]).toContain("- id: mystic");
    expect(pkg["agents.yaml"]).toContain("id: launch-writer");
    expect(pkg["model.yaml"]).toContain("default_model: anthropic/claude-sonnet-5.5");
  });
});

function ctxFor(agentsList = [chiefOfStaff({ providerId: "openai", model: "m" })]): ToolContext & { routines: Routine[]; notes: Map<string, string> } {
  const notes = new Map<string, string>();
  const routines: Routine[] = [];
  const ctx = {
    agent: agentsList[0],
    agents: () => agentsList,
    saveAgent: async (a: any) => {
      const i = agentsList.findIndex((x) => x.id === a.id);
      if (i === -1) agentsList.push(a);
      else agentsList[i] = a;
    },
    readNote: async (n: string) => notes.get(n) ?? null,
    writeNote: async (n: string, t: string) => void notes.set(n, t),
    addRoutine: async (r: Routine) => void routines.push(r),
    runAgent: async (_id: string, task: string) => `done: ${task}`,
    defaultModel: () => agentsList[0].model,
    depth: 0,
    chain: [agentsList[0].id],
    now: () => new Date(2026, 10, 6, 9, 0),
    routines,
    notes,
  };
  return ctx;
}

describe("local turn", () => {
  test("a write pauses for approval, runs once allowed, and the answer follows", async () => {
    const ctx = ctxFor();
    const replies = [
      sse([oai({ choices: [{ delta: { tool_calls: [{ index: 0, id: "c1", function: { name: "write_note", arguments: '{"name":"plan","text":"Ship it"}' } }] } }] }), oai({ choices: [{ delta: {}, finish_reason: "tool_calls" }] }), "data: [DONE]\n\n"]),
      sse([oai({ choices: [{ delta: { content: "Saved your plan." } }] }), oai({ choices: [{ delta: {}, finish_reason: "stop" }] })]),
    ];
    const asked: string[] = [];
    const events: AguiEvent[] = [];
    const history: ChatMessage[] = [{ role: "user", content: "Save a plan" }];
    for await (const e of runLocalTurn({
      agent: ctx.agent,
      team: ctx.agents(),
      history,
      provider: { id: "openai", kind: "openai_compat", baseUrl: "https://x/v1", apiKey: "k" },
      tools: BUILTIN_TOOLS,
      ctx,
      policy: { alwaysAllow: [] },
      askApproval: async (req) => {
        asked.push(req.summary);
        return "allow_once";
      },
      fetchImpl: async () => replies.shift()!,
      threadId: "t",
      runId: "r",
    }))
      events.push(e);

    expect(asked).toEqual(["Write note “plan”"]);
    expect(ctx.notes.get("plan")).toBe("Ship it");
    const turn = events.reduce(reduce, emptyTurn());
    expect(turn.text).toBe("Saved your plan.");
    expect(turn.tools[0]).toMatchObject({ name: "write_note", status: "done" });
    expect(turn.finished).toBe(true);
  });

  test("a refusal does nothing and says so", async () => {
    const ctx = ctxFor();
    const replies = [
      sse([oai({ choices: [{ delta: { tool_calls: [{ index: 0, id: "c1", function: { name: "create_agent", arguments: '{"name":"Outreach","instructions":"x"}' } }] } }] })]),
      sse([oai({ choices: [{ delta: { content: "Okay, I didn't create it." } }] })]),
    ];
    const answer = await finalAnswer(
      runLocalTurn({
        agent: ctx.agent,
        team: ctx.agents(),
        history: [{ role: "user", content: "make an outreach agent" }],
        provider: { id: "openai", kind: "openai_compat", baseUrl: "https://x/v1" },
        tools: BUILTIN_TOOLS,
        ctx,
        policy: { alwaysAllow: [] },
        askApproval: async () => "refuse",
        fetchImpl: async () => replies.shift()!,
        threadId: "t",
        runId: "r",
      }),
    );
    expect(answer).toBe("Okay, I didn't create it.");
    expect(ctx.agents()).toHaveLength(1);
  });

  test("a read runs without asking and a schedule is stored", async () => {
    const ctx = ctxFor();
    const r = await BUILTIN_TOOLS.find((t) => t.spec.name === "schedule_task")!.run({ when: "every weekday at 8am", task: "Morning brief" }, ctx);
    expect(r).toContain("Weekdays at 8 am");
    expect(ctx.routines[0].nextAt).toBe(new Date(2026, 10, 9, 8, 0).toISOString());
    expect(needsApproval("memory_read", { alwaysAllow: [] })).toBe(false);
  });
});

describe("ecn sign-in", () => {
  test("PKCE and the loopback authorize URL", async () => {
    const { verifier, challenge } = await pkcePair();
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const url = new URL(
      authorizeUrl(
        { authorization_endpoint: "https://www.earthcare.network/oauth/authorize", token_endpoint: "", registration_endpoint: "" },
        { clientId: "c", redirectUri: "http://127.0.0.1:53111/callback", challenge, state: "s" },
      ),
    );
    expect(url.searchParams.get("redirect_uri")).toBe("http://127.0.0.1:53111/callback");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("scope")).toBe("read build");
  });
});

describe("yaml", () => {
  test("quotes only what YAML would misread and blocks multi-line text", async () => {
    const { toYaml } = await import("./yaml");
    expect(toYaml({ a: "launch-writer", b: "no", c: "- x", d: "one\ntwo" })).toBe('a: launch-writer\nb: "no"\nc: "- x"\nd: |-\n  one\n  two\n');
  });
});

describe("review fixes", () => {
  test("MCP tools reach providers under a name they accept", async () => {
    const { providerSafeName } = await import("./mcp");
    expect(providerSafeName("ecn", "list_contacts")).toBe("ecn__list_contacts");
    expect(providerSafeName("ecn", "a.b/c")).toMatch(/^[a-zA-Z0-9_-]{1,64}$/);
  });

  test("a mixed tool is judged by its action, and Always allow never covers a delete", async () => {
    const { policyKey } = await import("./approvals");
    let policy = { alwaysAllow: [] as string[] };
    policy = applyDecision(policy, "ecn__crm_records", "always_allow", undefined, { action: "tag_records" });
    expect(policy.alwaysAllow).toEqual(["ecn__crm_records#tag_records"]);
    expect(needsApproval("ecn__crm_records", policy, undefined, { action: "tag_records" })).toBe(false);
    expect(needsApproval("ecn__crm_records", policy, undefined, { action: "archive_records" })).toBe(true);
    expect(needsApproval("ecn__media", policy, undefined, { action: "delete" })).toBe(true);
    expect(needsApproval("ecn__site", policy, undefined, { action: "publish", confirm: true })).toBe(true);
    expect(classify("ecn__site_read", undefined, { action: "list" })).toBe("read");
    expect(classify("ecn__anything", { destructiveHint: true })).toBe("outbound");
    expect(policyKey("write_note")).toBe("write_note");
  });

  test("openai parallel calls without an index stay separate", () => {
    const parts = [...openaiParts({ choices: [{ delta: { tool_calls: [{ id: "a", function: { name: "x", arguments: "{}" } }, { id: "b", function: { name: "y", arguments: "{}" } }] } }] })];
    expect(parts.filter((p) => p.type === "tool_call_start").map((p: any) => p.index)).toEqual([0, 1]);
  });

  test("an empty assistant turn is never sent", () => {
    const msgs: ChatMessage[] = [{ role: "user", content: "a" }, { role: "assistant", content: "" }, { role: "user", content: "b" }];
    const a = anthropicBody({ provider: { id: "anthropic", kind: "anthropic", baseUrl: "" }, model: "m", messages: msgs }) as any;
    const o = openaiBody({ provider: { id: "openai", kind: "openai_compat", baseUrl: "" }, model: "m", messages: msgs }) as any;
    expect(a.messages.map((m: any) => m.role)).toEqual(["user", "user"]);
    expect(o.messages.map((m: any) => m.role)).toEqual(["user", "user"]);
  });

  test("history is trimmed where the person spoke", async () => {
    const { trimHistory } = await import("./history");
    const h: ChatMessage[] = [
      { role: "user", content: "1" },
      { role: "assistant", content: "", toolCalls: [{ id: "c", name: "x", arguments: "{}" }] },
      { role: "tool", toolCallId: "c", name: "x", content: "r" },
      { role: "user", content: "2" },
      { role: "assistant", content: "ok" },
    ];
    expect(trimHistory(h, 3).map((m) => m.role)).toEqual(["user", "assistant"]);
  });

  test("schedules refuse what they can't run, and YAML quotes a trailing colon", async () => {
    expect(parseSchedule("every 2 weeks at 9")).toBeNull();
    expect(parseSchedule("every other day at 9am")).toBeNull();
    expect(parseSchedule("every 2 hours")).toEqual({ kind: "interval", minutes: 120 });
    const { toYaml } = await import("./yaml");
    expect(toYaml({ t: "Research:" })).toBe('t: "Research:"\n');
  });

  test("cloud events: corrected answers, portal cards and unfinished calls", () => {
    let t = emptyTurn("r");
    for (const e of [
      { type: "TEXT_MESSAGE_CONTENT", messageId: "m", delta: "Done, I saved it." },
      { type: "TOOL_CALL_START", toolCallId: "c1", toolCallName: "create_contact", needsApproval: true },
      { type: "TOOL_CALL_START", toolCallId: "c2", toolCallName: "list_contacts" },
      { type: "STATE_DELTA", delta: [{ op: "add", path: "/thread_id", value: "th-1" }] },
      { type: "CUSTOM", name: "answer_corrected", value: { messageId: "m", content: "I've drafted it; it waits for your yes." } },
      { type: "RUN_FINISHED", threadId: "t", runId: "r" },
    ] as AguiEvent[])
      t = reduce(t, e);
    expect(t.text).toBe("I've drafted it; it waits for your yes.");
    expect(t.tools.map((x) => x.status)).toEqual(["portal", "not_run"]);
    expect(t.threadId).toBe("th-1");
  });

  test("a handoff back into the chain is refused, and an unattended write says it needs a yes", async () => {
    const ctx = ctxFor();
    const handoff = BUILTIN_TOOLS.find((x) => x.spec.name === "handoff")!;
    const b = newAgent({ name: "B", instructions: "", model: ctx.agent.model }, [ctx.agent.id]);
    await ctx.saveAgent(b);
    const r = await handoff.run({ agent_id: ctx.agent.id, task: "x" }, { ...ctx, agent: b, chain: [ctx.agent.id, b.id] });
    expect(r).toContain("already working on this request");

    const replies = [
      sse([oai({ choices: [{ delta: { tool_calls: [{ index: 0, id: "c1", function: { name: "write_note", arguments: '{"name":"x","text":"y"}' } }] } }] })]),
      sse([oai({ choices: [{ delta: {} , finish_reason: "stop" }] })]),
    ];
    const events: AguiEvent[] = [];
    const history: ChatMessage[] = [{ role: "user", content: "routine" }];
    for await (const e of runLocalTurn({
      agent: ctx.agent, team: ctx.agents(), history, provider: { id: "openai", kind: "openai_compat", baseUrl: "https://x/v1" },
      tools: BUILTIN_TOOLS, ctx, policy: { alwaysAllow: [] }, askApproval: async () => "unattended",
      fetchImpl: async () => replies.shift()!, threadId: "t", runId: "r",
    })) events.push(e);
    const tool = history.find((m) => m.role === "tool") as any;
    expect(tool.content).toContain("No one was there to approve this");
    expect(ctx.notes.size).toBe(0);
    // The last step said nothing: the turn still closes with a sentence, and no empty message was saved.
    expect(events.reduce(reduce, emptyTurn()).text).toBe("I ran the steps above but didn't write an answer. Ask me to sum up.");
    expect(history.some((m) => m.role === "assistant" && !m.content && !(m as any).toolCalls)).toBe(false);
  });
});

describe("walk fixes", () => {
  test("text before and after a tool stays two paragraphs", () => {
    let t = emptyTurn("r");
    for (const e of [
      { type: "TEXT_MESSAGE_START", messageId: "a", role: "assistant" },
      { type: "TEXT_MESSAGE_CONTENT", messageId: "a", delta: "I'll save that." },
      { type: "TEXT_MESSAGE_END", messageId: "a" },
      { type: "TEXT_MESSAGE_START", messageId: "b", role: "assistant" },
      { type: "TEXT_MESSAGE_CONTENT", messageId: "b", delta: "Saved." },
    ] as AguiEvent[])
      t = reduce(t, e);
    expect(t.text).toBe("I'll save that.\n\nSaved.");
  });
});

test("a refused call reads refused, not done", () => {
  let t = emptyTurn("r");
  for (const e of [
    { type: "TOOL_CALL_START", toolCallId: "c", toolCallName: "write_note" },
    { type: "CUSTOM", name: "approval_refused", value: { toolCallId: "c" } },
    { type: "TOOL_CALL_RESULT", toolCallId: "c", content: "The person refused." },
  ] as AguiEvent[])
    t = reduce(t, e);
  expect(t.tools[0].status).toBe("refused");
});

test("the MCP door: /mcp on the public hosts, /mcp/ on a Django reached directly", () => {
  const { mcpUrl } = require("./ecn");
  expect(mcpUrl("https://www.earthcare.network")).toBe("https://www.earthcare.network/mcp");
  expect(mcpUrl("http://localhost:8070")).toBe("http://localhost:8070/mcp/");
});

describe("approval gate: audit fixes", () => {
  const { needsApproval, canAlwaysAllow, applyDecision, policyKey, classify } = approvalsMod;
  test("a routine (nobody there) asks for every write, even an always-allowed one", () => {
    const policy = { alwaysAllow: ["write_note"] };
    expect(needsApproval("write_note", policy)).toBe(false);
    expect(needsApproval("write_note", policy, undefined, undefined, true)).toBe(true);
    expect(needsApproval("read_note", policy, undefined, undefined, true)).toBe(false);
  });
  test("memory, new agents and routines are never always-allowed", () => {
    for (const t of ["memory_write", "create_agent", "schedule_task"]) {
      expect(canAlwaysAllow(t)).toBe(false);
      expect(applyDecision({ alwaysAllow: [] }, t, "always_allow").alwaysAllow).toEqual([]);
      expect(needsApproval(t, { alwaysAllow: [t] })).toBe(true);
    }
  });
  test("a sub-step is part of what Always allow remembers", () => {
    expect(policyKey("ecn__site", { action: "community", community_step: "create" })).toBe("ecn__site#community#create");
    expect(policyKey("ecn__site", { action: "community", community_step: "hosts" })).not.toBe(policyKey("ecn__site", { action: "community", community_step: "create" }));
  });
  test("a server's tool never borrows a built-in tool's class", () => {
    expect(classify("handoff")).toBe("read");
    expect(classify("ecn__handoff")).toBe("write");
  });
});

describe("Earth Care servers", () => {
  test("only known servers get a sign-in", () => {
    expect(ecnMod.isKnownOrigin("https://www.earthcare.network")).toBe(true);
    expect(ecnMod.isKnownOrigin("https://test.earthcare.network")).toBe(true);
    expect(ecnMod.isKnownOrigin("https://evil.example")).toBe(false);
  });
  test("discovery refuses endpoints on another host", async () => {
    const meta = { issuer: "https://www.earthcare.network", authorization_endpoint: "https://www.earthcare.network/oauth/authorize", token_endpoint: "https://evil.example/token", registration_endpoint: "https://www.earthcare.network/oauth/register" };
    const f = async () => new Response(JSON.stringify(meta), { status: 200 });
    await expect(ecnMod.discover("https://www.earthcare.network", f as any)).rejects.toThrow();
  });
});

describe("markdown", () => {
  const { parse, inline, safeHref } = mdMod;
  test("blocks: heading, list, code, table", () => {
    const b = parse("# Plan\n\n- one\n- **two**\n\n```ts\nconst x = 1;\n```\n\n| a | b |\n|--|--|\n| 1 | 2 |");
    expect(b.map((x) => x.t)).toEqual(["h", "ul", "code", "table"]);
  });
  test("links only for https and mailto", () => {
    expect(safeHref("https://earthcare.network")).toBe("https://earthcare.network");
    expect(safeHref("javascript:alert(1)")).toBeNull();
    expect(safeHref("file:///etc/passwd")).toBeNull();
    expect(safeHref("http://example.com")).toBeNull();
    expect(inline("[x](javascript:alert(1))")).toEqual([{ t: "text", v: "x" }, { t: "text", v: ")" }]);
  });
  test("html stays text", () => {
    expect(inline("<img src=x onerror=alert(1)>")).toEqual([{ t: "text", v: "<img src=x onerror=alert(1)>" }]);
  });
});

describe("web_fetch", () => {
  const { policyKey, needsApproval, applyDecision } = approvalsMod;
  test("asks per site, and Always allow covers only that site", () => {
    const p = applyDecision({ alwaysAllow: [] }, "web_fetch", "always_allow", undefined, { url: "https://example.org/a" });
    expect(p.alwaysAllow).toEqual(["web_fetch#example.org"]);
    expect(needsApproval("web_fetch", p, undefined, { url: "https://example.org/b?x=1" })).toBe(false);
    expect(needsApproval("web_fetch", p, undefined, { url: "https://evil.example/?d=secret" })).toBe(true);
    expect(policyKey("ecn__web_fetch", { url: "https://a.org" })).not.toBe("web_fetch#a.org");
  });
});
