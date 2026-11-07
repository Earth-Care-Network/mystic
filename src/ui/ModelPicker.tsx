import type { ModelChoice } from "../core/agents";
import { isMobile } from "../platform";
import { useEngine } from "./hooks";

/** Pick any provider the person set up, plus Earth Care Cloud when an enterprise on Pro allows it. */
export function ModelPicker({ value, onChange }: { value: ModelChoice; onChange: (m: ModelChoice) => void }) {
  const e = useEngine();
  const cloud = e.cloudEnterprise()?.cloud;
  if (isMobile)
    return (
      <p className="muted small">
        Runs on Earth Care Cloud for {e.cloudEnterprise()?.name || "your enterprise"}.
      </p>
    );
  return (
    <div className="model-picker">
      <label>
        Provider
        <select
          value={value.providerId === "ecn-cloud" || e.settings.providers.some((p) => p.id === value.providerId) ? value.providerId : ""}
          onChange={(ev) => {
            const pid = ev.target.value;
            if (pid === "ecn-cloud") return onChange({ providerId: "ecn-cloud", model: "jaguar" });
            onChange({ providerId: pid, model: e.modelFor(pid) || value.model || "" });
          }}
        >
          {!(value.providerId === "ecn-cloud" || e.settings.providers.some((p) => p.id === value.providerId)) ? (
            <option value="" disabled>
              Not set up — choose a model
            </option>
          ) : null}
          {e.settings.providers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
          <option value="ecn-cloud" disabled={!cloud}>
            Earth Care Cloud (Jaguar){cloud ? "" : " — needs an enterprise on Pro"}
          </option>
        </select>
      </label>
      {value.providerId !== "ecn-cloud" ? (
        <label>
          Model
          <input value={value.model} onChange={(ev) => onChange({ ...value, model: ev.target.value })} placeholder="Model id" spellCheck={false} />
        </label>
      ) : null}
    </div>
  );
}
