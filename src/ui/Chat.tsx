import { cardProposal } from "../core/ecn";
import { summarize } from "../core/approvals";
import { Markdown } from "./Markdown";
import { useEffect, useRef, useState } from "react";
import type { ApprovalRequest, ToolCallView } from "../core/agui";
import type { Agent } from "../core/agents";
import { engine, type Chat as ChatData } from "../engine";
import { useEngine } from "./hooks";
import { openUrl } from "../platform";

const SUGGESTIONS: Record<string, string[]> = {
  "chief-of-staff": [
    "Here's what I do. Set up the agents I need.",
    "Give me a morning brief every weekday at 8am.",
    "What's on my team right now?",
  ],
};

export function ChatView({ agent, onOpenPanel, panelOpen, onSettings }: { agent: Agent; onOpenPanel: () => void; panelOpen: boolean; onSettings: (tab: string) => void }) {
  const e = useEngine();
  const [chat, setChat] = useState<ChatData | null>(null);
  const [draft, setDraft] = useState("");
  const end = useRef<HTMLDivElement>(null);
  const live = e.live.get(agent.id);
  const busy = e.busy.has(agent.id);

  useEffect(() => {
    let on = true;
    void engine.chat(agent.id).then((c) => on && setChat({ ...c }));
    return () => {
      on = false;
    };
  }, [agent.id, e.live.size, e.busy.size, chat?.log.length]);

  // A block body: newer WebKit/Chromium return a Promise from scrollIntoView, and an
  // effect must return nothing or a cleanup function.
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [chat?.log.length, live?.turn.text, live?.turn.approvals.length]);

  const send = (text: string) => {
    const t = text.trim();
    if (!t || busy) return;
    setDraft("");
    void engine.send(agent.id, t).then(() => engine.chat(agent.id).then((c) => setChat({ ...c })));
  };

  const empty = chat && chat.log.length === 0 && !live;

  return (
    <section className="chat">
      <header className="chat-head" data-tauri-drag-region>
        <div>
          <h1>{agent.name}</h1>
          <p className="muted">{agent.title || "Agent"} · {agent.model.providerId === "ecn-cloud" ? "Earth Care Cloud" : agent.model.model}</p>
        </div>
        <button className="ghost" aria-pressed={panelOpen} onClick={onOpenPanel}>
          Agent settings
        </button>
      </header>
      <div className="log" aria-live="polite">
        {empty ? (
          <div className="empty">
            <p>{agent.builtIn ? "I'm your Chief of Staff. Tell me about your work and I'll set up the agents you need." : `Ask ${agent.name} to get started.`}</p>
            <div className="chips">
              {(SUGGESTIONS[agent.id] || []).map((s) => (
                <button key={s} className="chip" onClick={() => send(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        {chat?.log.map((m) => (
          <div key={m.id} className={`msg ${m.role}`}>
            {m.via ? <div className="via">{m.via}</div> : null}
            {m.tools?.length ? <Tools tools={m.tools} /> : null}
            {m.tools
              ?.filter((t) => t.status === "portal" && cardProposal(t.args))
              .map((t) => <CloudCard key={t.id} agentId={agent.id} messageId={m.id} tool={t} />)}
            {m.text ? <Paragraphs text={m.text} md={m.role !== "user"} /> : null}
            {m.tools?.some((t) => t.status === "portal") ? (
              <button className="link small" onClick={() => void openUrl(`${e.settings.ecn.origin}/portal?jaguar=full${chat?.ecnThreadId ? `&thread=${chat.ecnThreadId}` : ""}`)}>
                Review it in Earth Care Network
              </button>
            ) : null}
            {m.error ? <ErrorLine text={m.error} onSettings={onSettings} /> : null}
          </div>
        ))}
        {live ? (
          <div className="msg assistant">
            {live.turn.tools.length ? <Tools tools={live.turn.tools} /> : null}
            {live.turn.text ? <Paragraphs text={live.turn.text} /> : <div className="typing" aria-label="Working">•••</div>}
            {live.turn.approvals.map((a) => (
              <Approval key={a.id} req={a} />
            ))}
            {live.turn.error ? <ErrorLine text={live.turn.error.message} onSettings={onSettings} /> : null}
          </div>
        ) : null}
        <div ref={end} />
      </div>
      <form
        className="composer"
        onSubmit={(ev) => {
          ev.preventDefault();
          send(draft);
        }}
      >
        <label className="sr-only" htmlFor="composer">
          Message {agent.name}
        </label>
        <textarea
          id="composer"
          rows={2}
          value={draft}
          placeholder={`Message ${agent.name}`}
          onChange={(ev) => setDraft(ev.target.value)}
          onKeyDown={(ev) => {
            if (ev.key === "Enter" && !ev.shiftKey) {
              ev.preventDefault();
              send(draft);
            }
          }}
        />
        {busy ? (
          <button type="button" className="secondary" disabled={!live} onClick={() => engine.stop(agent.id)}>
            Stop
          </button>
        ) : (
          <button type="submit" className="primary" disabled={!draft.trim()}>
            Send
          </button>
        )}
      </form>
    </section>
  );
}

/** The person's words stay as typed; an agent's answer keeps its formatting. */
function Paragraphs({ text, md = true }: { text: string; md?: boolean }) {
  if (md) return <Markdown text={text} />;
  return <p className="bubble">{text}</p>;
}

const STATUS: Record<ToolCallView["status"], string> = {
  running: "…",
  waiting: "waiting for you",
  done: "done",
  refused: "not done",
  not_run: "not run",
  portal: "waiting for your yes in Earth Care Network",
};

function Tools({ tools }: { tools: ToolCallView[] }) {
  return (
    <ul className="tools">
      {tools.map((t) => (
        <li key={t.id} className={`tool ${t.status}`}>
          <span className="dot" aria-hidden />
          {t.name.replace(/^ecn\//, "Earth Care Network · ").replace(/_/g, " ")}
          <span className="status">{STATUS[t.status]}</span>
        </li>
      ))}
    </ul>
  );
}

/** A write Jaguar queued on Earth Care Cloud: decided here, run by Earth Care Network. */
function CloudCard({ agentId, messageId, tool }: { agentId: string; messageId: string; tool: ToolCallView }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const card = cardProposal(tool.args);
  const shown = card ? Object.fromEntries(Object.entries(card.args).filter(([k]) => k !== "suggestion_id")) : {};
  const decide = async (yes: boolean) => {
    setBusy(true);
    setError("");
    try {
      await engine.decideCloudCard(agentId, messageId, tool.id, yes);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="approval" role="group" aria-label="Approval needed">
      <div className="approval-title">{summarize(tool.name, shown)}</div>
      <p className="muted small">Jaguar will do this in Earth Care Network once you say yes.</p>
      <button className="link small" onClick={() => setOpen((o) => !o)}>
        {open ? "Hide details" : "Show exactly what it will do"}
      </button>
      {open ? <pre className="args">{JSON.stringify(shown, null, 2)}</pre> : null}
      {error ? <p className="error" role="alert">{error}</p> : null}
      <div className="row">
        <button className="secondary" disabled={busy} onClick={() => void decide(false)}>
          Refuse
        </button>
        <button className="primary" disabled={busy} onClick={() => void decide(true)}>
          {busy ? "Working…" : "Allow once"}
        </button>
      </div>
    </div>
  );
}

function Approval({ req }: { req: ApprovalRequest }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="approval" role="group" aria-label="Approval needed">
      <div className="approval-title">{req.summary}</div>
      <button className="link small" onClick={() => setOpen((o) => !o)}>
        {open ? "Hide details" : "Show exactly what it will do"}
      </button>
      {open ? <pre className="args">{JSON.stringify(req.args, null, 2)}</pre> : null}
      <div className="row">
        <button className="secondary" onClick={() => engine.decide(req.id, "refuse")}>
          Refuse
        </button>
        {req.canAlways !== false ? (
          <button className="secondary" onClick={() => engine.decide(req.id, "always_allow")}>
            Always allow
          </button>
        ) : null}
        <button className="primary" onClick={() => engine.decide(req.id, "allow_once")}>
          Allow once
        </button>
      </div>
    </div>
  );
}

function ErrorLine({ text, onSettings }: { text: string; onSettings: (tab: string) => void }) {
  const tab = /Cloud|Earth Care Network|Pro/.test(text) ? "cloud" : /Models|key|provider/i.test(text) ? "models" : null;
  return (
    <div className="error" role="alert">
      {text}
      {tab ? (
        <button className="link small" onClick={() => onSettings(tab)}>
          Open settings
        </button>
      ) : null}
    </div>
  );
}
