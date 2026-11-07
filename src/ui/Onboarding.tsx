import { useState } from "react";
import { engine } from "../engine";
import { useEngine } from "./hooks";
import { ProviderForm } from "./ProviderForm";

export function Onboarding({ onDone }: { onDone: () => void }) {
  const e = useEngine();
  const [error, setError] = useState("");
  const me = e.me;
  const signedIn = !!me && !("off" in me);
  const [busy, setBusy] = useState(false);
  return (
    <div className="onboarding">
      <div className="hero">
        <span className="mark big" aria-hidden />
        <h1>Mystic</h1>
        <p className="lede">Your team of AI agents. Free and open source, on any key you bring.</p>
        <p className="ethics">Earth Care · People Care · Future Care · Fair Share</p>
      </div>
      <div className="doors">
        <section>
          <h2>Bring your own key</h2>
          <p className="muted">OpenRouter, Anthropic, OpenAI, Gemini, Grok, a model on this Mac, or any compatible endpoint.</p>
          <ProviderForm onAdded={onDone} />
        </section>
        <section>
          <h2>Or sign in to Earth Care Network</h2>
          <p className="muted">Your agents get your enterprise's context and tools. With an enterprise on Pro, they can run on Earth Care Cloud.</p>
          {me && "off" in me ? <p className="error">Earth Care Cloud isn't switched on at this server yet. Add a key to start.</p> : null}
          {signedIn ? (
            <p className="muted">
              You're signed in as {me.user.name}. None of your enterprises is on Pro, so Earth Care Cloud isn't available. Add a key to start, or{" "}
              <button className="link" onClick={() => void import("../platform").then((p) => p.openUrl(`${e.settings.ecn.origin}${me.upgrade_path}`))}>
                start Pro's trial
              </button>
              .
            </p>
          ) : null}
          <button
            className="secondary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                await engine.signIn();
                if (engine.hasUsableModel()) onDone();
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
        </section>
      </div>
    </div>
  );
}
