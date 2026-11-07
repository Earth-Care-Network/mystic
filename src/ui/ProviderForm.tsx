import { useState } from "react";
import { PRESETS, preset } from "../core/providers";
import { engine } from "../engine";

/** Add any key: a preset, a local model, or any OpenAI-compatible URL. The key goes to the keychain. */
export function ProviderForm({ onAdded }: { onAdded?: () => void }) {
  const [pid, setPid] = useState("openrouter");
  const [key, setKey] = useState("");
  const [url, setUrl] = useState("");
  const [model, setModel] = useState(preset("openrouter")!.defaultModel);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const p = preset(pid)!;
  const custom = pid === "custom";

  return (
    <form
      className="card"
      onSubmit={async (ev) => {
        ev.preventDefault();
        setError("");
        if (p.needsKey && !key.trim()) return setError("Paste the key for this provider.");
        if (custom && !/^https?:\/\//.test(url.trim())) return setError("Give the endpoint's address, starting with https://.");
        if (!model.trim()) return setError("Name the model to use, for example the one your endpoint serves.");
        setBusy(true);
        try {
          await engine.addProvider({ id: pid, key: key || undefined, baseUrl: custom ? url : undefined, label: custom ? url.replace(/^https?:\/\//, "") : undefined, model });
          setKey("");
          onAdded?.();
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <label>
        Provider
        <select
          value={pid}
          onChange={(e) => {
            setPid(e.target.value);
            setModel(preset(e.target.value)?.defaultModel || "");
          }}
        >
          {PRESETS.map((x) => (
            <option key={x.id} value={x.id}>
              {x.label}
            </option>
          ))}
        </select>
      </label>
      {custom ? (
        <label>
          Endpoint
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://my-gateway.example/v1" spellCheck={false} />
        </label>
      ) : null}
      <label>
        Model
        <input value={model} onChange={(e) => setModel(e.target.value)} placeholder="Model id, e.g. llama3.3" spellCheck={false} />
      </label>
      {p.needsKey || custom ? (
        <label>
          {custom ? "Key (if it needs one)" : "Key"}
          <input type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} placeholder={p.keyHint || ""} spellCheck={false} />
        </label>
      ) : (
        <p className="muted small">No key needed. Make sure {p.label.replace(/ \(.*/, "")} is running on this Mac.</p>
      )}
      <p className="muted small">Keys stay in your Mac's keychain. Mystic sends them only to that provider.</p>
      {error ? <p className="error">{error}</p> : null}
      <button className="primary" disabled={busy}>
        {busy ? "Adding…" : "Add"}
      </button>
    </form>
  );
}
