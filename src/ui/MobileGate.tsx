import { useState } from "react";
import { engine } from "../engine";
import { useEngine } from "./hooks";

/**
 * Mystic on iPhone and iPad runs on Earth Care Cloud: it needs an Earth Care
 * Network sign-in and an enterprise on Pro. Nothing here sells a plan in the app;
 * the enterprise's owner starts Pro on earthcare.network.
 */
export function MobileGate() {
  const e = useEngine();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const me = e.me;

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

  return (
    <div className="onboarding mobile-gate">
      <div className="hero">
        <span className="mark big" aria-hidden />
        <h1>Mystic</h1>
        <p className="lede">Your team of AI agents, on Earth Care Cloud.</p>
        <p className="ethics">Earth Care · People Care · Future Care · Fair Share</p>
      </div>

      {!me ? (
        <section className="gate-card">
          <h2>Sign in to Earth Care Network</h2>
          <p className="muted">Mystic on iPhone runs your agents on Earth Care Cloud with your enterprise's context and tools. It needs an enterprise on Pro.</p>
          <button className="primary wide" disabled={busy} onClick={() => void signIn()}>
            {busy ? "Waiting for Safari…" : "Sign in"}
          </button>
          {error ? <p className="error">{error}</p> : null}
        </section>
      ) : "off" in me ? (
        <section className="gate-card">
          <h2>Not switched on yet</h2>
          <p className="muted">Earth Care Cloud for Mystic isn't switched on at this server yet.</p>
          <button className="secondary wide" onClick={() => void engine.signOut()}>
            Sign out
          </button>
        </section>
      ) : (
        <section className="gate-card">
          <h2>Mystic needs an enterprise on Pro</h2>
          <p className="muted">
            You're signed in as {me.user.name}.{" "}
            {me.enterprises.length
              ? "None of your enterprises is on Pro, or your seat on it doesn't run its agents. An owner can start Pro on earthcare.network, then come back here."
              : "You're not on an enterprise yet. Create one on earthcare.network, start Pro, then come back here."}
          </p>
          {me.enterprises.length ? (
            <ul className="list">
              {me.enterprises.map((ent) => (
                <li key={ent.organization_id}>
                  <span>{ent.name}</span>
                  <span className="muted small">{ent.reason === "seat" ? "your seat can't run agents" : ent.tier === "pro" ? "Pro" : ent.tier === "free" ? "Free" : "Starter"}</span>
                </li>
              ))}
            </ul>
          ) : null}
          <div className="row">
            <button className="secondary" onClick={() => void engine.signOut()}>
              Sign out
            </button>
            <button className="primary" onClick={() => void engine.refreshMe()}>
              Check again
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
