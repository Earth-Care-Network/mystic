import { useEffect, useState } from "react";
import { engine } from "../engine";
import { checkForUpdate, folder, isMobile, openUrl, type UpdateStatus } from "../platform";
import { useEngine } from "./hooks";
import { ProviderForm } from "./ProviderForm";

const ALL_TABS = [
  ["models", "Models & keys"],
  ["cloud", "Earth Care Network"],
  ["routines", "Routines"],
  ["approvals", "Approvals"],
  ["folder", "Your folder"],
  ["updates", "Updates"],
] as const;
// On a phone: no keys (Earth Care Cloud only), no folder to open, updates come from the App Store.
const TABS = isMobile ? ALL_TABS.filter(([k]) => k === "cloud" || k === "routines" || k === "approvals") : ALL_TABS;

export function SettingsView({ tab }: { tab?: string }) {
  const first = TABS[0][0];
  const [active, setActive] = useState(tab || first);
  useEffect(() => {
    setActive(tab && TABS.some(([k]) => k === tab) ? tab : first);
  }, [tab]);
  return (
    <section className="settings">
      <header className="chat-head" data-tauri-drag-region>
        <h1>Settings</h1>
      </header>
      <div className="tabs" role="tablist">
        {TABS.map(([k, label]) => (
          <button key={k} role="tab" aria-selected={active === k} className={active === k ? "tab active" : "tab"} onClick={() => setActive(k)}>
            {label}
          </button>
        ))}
      </div>
      <div className="tab-body">
        {active === "models" ? <Models /> : null}
        {active === "cloud" ? <Cloud /> : null}
        {active === "routines" ? <Routines /> : null}
        {active === "approvals" ? <Approvals /> : null}
        {active === "folder" ? <Folder /> : null}
        {active === "updates" ? <Updates /> : null}
      </div>
    </section>
  );
}

function Models() {
  const e = useEngine();
  return (
    <>
      <h2>Your models</h2>
      {e.settings.providers.length ? (
        <ul className="list">
          {e.settings.providers.map((p) => (
            <li key={p.id}>
              <span>
                {p.label}
                <span className="muted small"> · {p.hasKey ? "key in keychain" : "no key"}</span>
              </span>
              <button className="link small danger" onClick={() => void engine.removeProvider(p.id)}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">None yet.</p>
      )}
      <h2>Add one</h2>
      <ProviderForm />
    </>
  );
}

function Cloud() {
  const e = useEngine();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const me = e.me;
  const origin = e.settings.ecn.origin;

  const server = (
    <details className="small">
      <summary>Server</summary>
      <select value={origin} onChange={(ev) => void engine.setOrigin(ev.target.value)}>
        <option value="https://www.earthcare.network">www.earthcare.network</option>
        <option value="https://test.earthcare.network">test.earthcare.network</option>
      </select>
    </details>
  );

  if (me && "off" in me)
    return (
      <>
        <p className="muted">Earth Care Cloud for Mystic isn't switched on at {origin.replace("https://", "")} yet. Your own keys keep working.</p>
        <div className="row">
          <button className="link danger" onClick={() => void engine.signOut()}>
            Sign out
          </button>
        </div>
        {server}
      </>
    );

  if (!me)
    return (
      <>
        <h2>Earth Care Network</h2>
        <p>Sign in once. Your agents can then use your enterprise's context and tools, and with an enterprise on Pro, run on Earth Care Cloud.</p>
        <button
          className="primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              await engine.signIn();
            } catch (err) {
              setError((err as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Waiting for your browser…" : "Sign in to Earth Care Network"}
        </button>
        {error ? <p className="error">{error}</p> : null}
        {server}
      </>
    );

  const chosen = e.cloudEnterprise();
  return (
    <>
      <h2>Signed in as {me.user.name}</h2>
      <p className="muted small">{me.user.email}</p>
      <h2>Earth Care Cloud</h2>
      {me.enterprises.length ? (
        <ul className="list">
          {me.enterprises.map((ent) => (
            <li key={ent.organization_id}>
              <label className="radio">
                <input
                  type="radio"
                  name="enterprise"
                  disabled={!ent.cloud}
                  checked={chosen?.organization_id === ent.organization_id}
                  onChange={() => void engine.saveSettings({ ecn: { ...e.settings.ecn, enterpriseId: ent.organization_id } })}
                />
                {ent.name}
                <span className="muted small">
                  {" "}
                  · {ent.tier === "pro" ? (ent.trial_days_left ? `Pro trial, ${ent.trial_days_left} days left` : "Pro") : "Starter"}
                  {ent.reason === "seat" ? " · your seat can't run its agents" : ""}
                </span>
              </label>
              {ent.reason === "requires_pro" ? (
                <button className="link small" onClick={() => void openUrl(`${origin}${me.upgrade_path}`)}>
                  Start Pro
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p>
          You're not on an enterprise yet.{" "}
          <button className="link" onClick={() => void openUrl(`${origin}/start?from=mystic`)}>
            Start one
          </button>
        </p>
      )}
      <p className="muted small">
        Earth Care Cloud runs an agent on Jaguar for the enterprise you pick, with its context and tools, on its Pro plan. Choose it per agent in Agent settings. Every write still waits for your yes in Earth Care Network.
      </p>
      <label className="check">
        <input type="checkbox" checked={e.settings.ecn.toolsForAgents} onChange={(ev) => void engine.saveSettings({ ecn: { ...e.settings.ecn, toolsForAgents: ev.target.checked } })} />
        Give my agents my Earth Care Network tools (on any model)
      </label>
      {e.ecnToolsNote ? <p className="muted small">{e.ecnToolsNote}</p> : null}
      <div className="row">
        <button className="secondary" onClick={() => void engine.refreshMe()}>
          Refresh
        </button>
        <button className="link danger" onClick={() => void engine.signOut()}>
          Sign out
        </button>
      </div>
    </>
  );
}

function Routines() {
  const e = useEngine();
  return (
    <>
      <h2>Routines</h2>
      <p className="muted small">Ask any agent to do something on a schedule ("every weekday at 8am, brief me"). They run while Mystic is open. Nobody is there to approve, so a routine only reads and writes notes you allowed; anything else it would do, it tells you it needs your yes.</p>
      {e.routines.length ? (
        <ul className="list">
          {e.routines.map((r) => (
            <li key={r.id}>
              <span>
                <strong>{r.label}</strong> · {e.agents.find((a) => a.id === r.agentId)?.name || r.agentId}
                <br />
                <span className="muted small">{r.task} · next {new Date(r.nextAt).toLocaleString()}</span>
              </span>
              <button className="link small danger" onClick={() => void engine.deleteRoutine(r.id)}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">None yet.</p>
      )}
    </>
  );
}

function Approvals() {
  const e = useEngine();
  const allowed = e.settings.policy.alwaysAllow;
  return (
    <>
      <h2>Always allowed</h2>
      <p className="muted small">Reads never ask. Anything that changes something asks once, unless you chose Always allow. Sending, posting, paying, signing and deleting always ask.</p>
      {allowed.length ? (
        <ul className="list">
          {allowed.map((t) => (
            <li key={t}>
              <code>{t.replace("#", " · ")}</code>
              <button className="link small" onClick={() => void engine.saveSettings({ policy: { alwaysAllow: allowed.filter((x) => x !== t) } })}>
                Ask again
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">Nothing yet.</p>
      )}
    </>
  );
}

function Folder() {
  const [dir, setDir] = useState("");
  const [exported, setExported] = useState<string[]>([]);
  useEffect(() => {
    void folder.dir().then(setDir);
  }, []);
  return (
    <>
      <h2>Your folder</h2>
      <p>Agents, conversations, memory, notes and routines are plain files in <code>{dir}</code>. Keys are not: they're in your keychain.</p>
      <button className="secondary" onClick={() => void folder.open()}>
        Open the folder
      </button>
      <h2>Run this team on OpenDuet</h2>
      <p className="muted small">Export your agents as an OpenDuet tenant package (brand, agents, model, skills, channels) to run the same team on a self-hosted OpenDuet or OpenBot server.</p>
      <button className="secondary" onClick={() => void engine.exportOpenDuet().then(setExported)}>
        Export to the folder
      </button>
      {exported.length ? <p className="muted small">Wrote openduet/{exported.join(", openduet/")}.</p> : null}
    </>
  );
}

function Updates() {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [install, setInstall] = useState<((p: (n: number) => void) => Promise<void>) | undefined>();
  const [pct, setPct] = useState<number | null>(null);
  const check = async () => {
    setStatus(null);
    const r = await checkForUpdate();
    setStatus(r.status);
    setInstall(() => r.install);
  };
  useEffect(() => {
    void check();
  }, []);
  return (
    <>
      <h2>Updates</h2>
      <p className="muted small">Mystic checks its signed release feed when it starts. Updates install only when you say so.</p>
      {!status ? <p className="muted">Checking…</p> : null}
      {status?.state === "none" ? <p>You're on the latest version.</p> : null}
      {status?.state === "error" ? <p className="error">{status.error}</p> : null}
      {status?.state === "available" ? (
        <div className="card">
          <p>
            <strong>Mystic {status.version}</strong> is ready.
          </p>
          {status.notes ? <p className="muted small">{status.notes}</p> : null}
          <button className="primary" disabled={pct !== null} onClick={() => install && void install(setPct)}>
            {pct === null ? "Install and restart" : `Downloading ${pct}%`}
          </button>
        </div>
      ) : null}
      <button className="link small" onClick={() => void check()}>
        Check again
      </button>
    </>
  );
}
