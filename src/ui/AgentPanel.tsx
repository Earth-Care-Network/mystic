import { useEffect, useState } from "react";
import type { Agent } from "../core/agents";
import { engine } from "../engine";
import { ModelPicker } from "./ModelPicker";

type Field = "name" | "title" | "instructions" | "model" | "memory";

/**
 * An agent's settings. Only the fields the person touched are theirs: the rest follow
 * the agent, which may remember something (memory_write) while this panel is open.
 */
export function AgentPanel({ agent, onClose, onDeleted }: { agent: Agent; onClose: () => void; onDeleted: () => void }) {
  const [draft, setDraft] = useState(agent);
  const [touched, setTouched] = useState<Set<Field>>(new Set());
  const [undo, setUndo] = useState<Agent | null>(null);

  useEffect(() => {
    setDraft((d) => {
      if (d.id !== agent.id) return agent;
      const mine = Object.fromEntries([...touched].map((k) => [k, d[k]]));
      return { ...agent, ...mine };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `touched` is read as of this render
  }, [agent]);

  useEffect(() => {
    setTouched(new Set());
    setUndo(null);
  }, [agent.id]);

  const edit = <K extends Field>(k: K, v: Agent[K]) => {
    setDraft((d) => ({ ...d, [k]: v }));
    setTouched((t) => new Set(t).add(k));
  };

  return (
    <aside className="panel" aria-label={`${agent.name} settings`}>
      <header>
        <h2>{agent.name}</h2>
        <button className="ghost" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </header>
      <label>
        Name
        <input value={draft.name} onChange={(e) => edit("name", e.target.value)} />
      </label>
      <label>
        What it does
        <input value={draft.title} onChange={(e) => edit("title", e.target.value)} />
      </label>
      <ModelPicker value={draft.model} onChange={(model) => edit("model", model)} />
      <p className="muted small">Switching models keeps this agent's job, memory and conversation.</p>
      <label>
        Instructions
        <textarea rows={7} value={draft.instructions} onChange={(e) => edit("instructions", e.target.value)} />
      </label>
      <label>
        Memory
        <textarea
          rows={6}
          value={draft.memory}
          placeholder="Nothing yet. It saves what it learns about how you like work done."
          onChange={(e) => edit("memory", e.target.value)}
        />
      </label>
      <div className="row">
        {undo ? (
          <button
            className="secondary"
            onClick={() => {
              void engine.saveAgent(undo);
              setDraft(undo);
              setUndo(null);
            }}
          >
            Undo
          </button>
        ) : null}
        <button
          className="primary"
          disabled={!touched.size}
          onClick={() => {
            const latest = engine.agents.find((a) => a.id === agent.id) || agent;
            const mine = Object.fromEntries([...touched].map((k) => [k, draft[k]]));
            setUndo(latest);
            setTouched(new Set());
            void engine.saveAgent({ ...latest, ...mine });
          }}
        >
          Save
        </button>
      </div>
      <hr />
      <button className="link small" onClick={() => void engine.clearChat(agent.id)}>
        Clear this conversation
      </button>
      {!agent.builtIn ? (
        <button
          className="link small danger"
          onClick={() => {
            if (confirm(`Remove ${agent.name}? Its conversation stays in the Mystic folder.`)) void engine.deleteAgent(agent.id).then(onDeleted);
          }}
        >
          Remove this agent
        </button>
      ) : null}
    </aside>
  );
}
