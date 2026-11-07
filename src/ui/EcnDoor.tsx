import { useState } from "react";
import { ECN_ORIGINS } from "../core/ecn";
import { engine } from "../engine";
import { isMobile, openUrl } from "../platform";
import { useEngine } from "./hooks";

const host = (origin: string) => origin.replace(/^https?:\/\//, "");
const TIER: Record<string, string> = { pro: "Pro", starter: "Starter", free: "Free" };

/**
 * Sign in to Earth Care Network, in one card for every state: which server, waiting for
 * the browser, the server without Mystic's cloud, signed in without Pro, and ready.
 * Onboarding (Mac) and the phone gate draw the same card, so the words match.
 */
export function EcnDoor({ primary = false }: { primary?: boolean }) {
  const e = useEngine();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const origin = e.settings.ecn.origin;
  const me = e.me;
  const off = !!me && "off" in me;
  const signedIn = !!me && !off;
  const browser = isMobile ? "Safari" : "your browser";

  const signIn = async () => {
    setBusy(true);
    setError("");
    try {
      await engine.signIn();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const servers: [string, string][] = [
    [ECN_ORIGINS.production, "Earth Care Network"],
    [ECN_ORIGINS.test, "TEST"],
  ];
  const known = servers.some(([o]) => o === origin);

  return (
    <section className="door card" aria-live="polite">
      <header className="door-head">
        <h2>Earth Care Network</h2>
        <span className={`pill ${signedIn ? (e.cloudEnterprises().length ? "ok" : "wait") : ""}`}>
          {signedIn ? (e.cloudEnterprises().length ? "Cloud ready" : "Signed in") : off ? "Signed in" : "Not signed in"}
        </span>
      </header>

      {!me ? (
        <p className="muted">
          {isMobile
            ? "Mystic on iPhone runs your agents on Earth Care Cloud, with your enterprise's context and tools. It needs an enterprise on Pro."
            : "Your agents get your enterprise's context and tools. With an enterprise on Pro, they can also run on Earth Care Cloud, with no key of your own."}
        </p>
      ) : off ? (
        <div className="notice">
          <p>
            <strong>Earth Care Cloud isn't on at {host(origin)} yet.</strong> Your sign-in worked, but this server doesn't run Mystic's cloud.
          </p>
          {origin !== ECN_ORIGINS.test ? (
            <button className="secondary" onClick={() => void engine.setOrigin(ECN_ORIGINS.test).then(signIn)}>
              Use TEST instead
            </button>
          ) : null}
        </div>
      ) : (
        <>
          <p className="muted">
            Signed in as <strong>{me.user.name || me.user.email}</strong> on {host(origin)}.
          </p>
          {me.enterprises.length ? (
            <ul className="list ents">
              {me.enterprises.map((ent) => (
                <li key={ent.organization_id}>
                  <span className="ent-name">{ent.name}</span>
                  {ent.cloud ? (
                    <span className="ent-actions">
                      <span className="pill ok">{ent.trial_days_left ? `Pro trial · ${ent.trial_days_left} days` : "Pro · cloud on"}</span>
                      <WorkspaceAction ent={ent} />
                    </span>
                  ) : ent.reason === "seat" ? (
                    <span className="muted small">Your seat can't run its agents</span>
                  ) : (
                    <button className="link small" onClick={() => void openUrl(`${origin}${me.upgrade_path}`)}>
                      {TIER[ent.tier] || ent.tier} · start Pro's trial
                    </button>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">You aren't on an enterprise yet. Create one on {host(origin)}, then come back.</p>
          )}
          {!e.cloudEnterprises().length ? (
            <button className="secondary" onClick={() => void engine.refreshMe()}>
              Check again
            </button>
          ) : null}
        </>
      )}

      {!signedIn && !off ? (
        <>
          <button className={primary ? "primary wide" : "secondary wide"} disabled={busy} onClick={() => void signIn()}>
            {busy ? `Waiting for ${browser}…` : `Sign in with ${host(origin)}`}
          </button>
          <p className="muted small">{busy ? `Say yes in ${browser}, then come back here.` : `Opens ${browser}. Mystic never sees your password.`}</p>
        </>
      ) : null}
      {error ? <p className="error" role="alert">{error}</p> : null}

      <div className="door-foot">
        <label className="inline small">
          Server
          <select value={origin} disabled={busy} onChange={(ev) => void engine.setOrigin(ev.target.value)}>
            {servers.map(([o, label]) => (
              <option key={o} value={o}>
                {label} ({host(o)})
              </option>
            ))}
            {!known ? <option value={origin}>{host(origin)}</option> : null}
          </select>
        </label>
        {me ? (
          <button className="link small" onClick={() => void engine.signOut()}>
            Sign out
          </button>
        ) : null}
      </div>
    </section>
  );
}

/**
 * Mystic Cloud, the enterprise's own workspace (OpenDuet signing in with Earth Care Network): open
 * it once it is live, see that it is being set up, or, for an owner or admin, turn it on.
 */
function WorkspaceAction({ ent }: { ent: import("../core/ecn").Enterprise }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const ws = ent.workspace;
  if (ws === undefined) return null;
  if (ws?.status === "live" && ws.url)
    return (
      <button className="link small" onClick={() => void openUrl(ws.url)}>
        Open Mystic Cloud
      </button>
    );
  if (ws) return <span className="muted small">{ws.status === "suspended" ? "Mystic Cloud paused" : ws.status === "failed" ? "Mystic Cloud couldn't start" : "Setting up Mystic Cloud"}</span>;
  if (!["owner", "admin"].includes(ent.role)) return null;
  return (
    <>
      <button
        className="link small"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            await engine.requestWorkspace(ent.organization_id);
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Turning on…" : "Turn on Mystic Cloud"}
      </button>
      {error ? <span className="error small">{error}</span> : null}
    </>
  );
}
