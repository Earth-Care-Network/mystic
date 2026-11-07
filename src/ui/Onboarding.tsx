import { EcnDoor } from "./EcnDoor";
import { Mark } from "./Mark";
import { ProviderForm } from "./ProviderForm";

/** First run on a Mac: two ways in, side by side. Either one makes Mystic usable. */
export function Onboarding({ onDone }: { onDone: () => void }) {
  return (
    <div className="onboarding">
      <div className="hero">
        <Mark big />
        <h1>Mystic</h1>
        <p className="by">by Earth Care Network</p>
        <p className="lede">Your team of AI agents. Free and open source, on any key you bring.</p>
      </div>
      <ol className="doors">
        <li>
          <span className="step">1 · One way</span>
          <h2>Bring your own key</h2>
          <p className="muted">OpenRouter, Anthropic, OpenAI, Gemini, Grok, a model on this Mac, or any compatible endpoint.</p>
          <ProviderForm onAdded={onDone} />
        </li>
        <li>
          <span className="step">2 · Or</span>
          <h2>Sign in</h2>
          <p className="muted">Use your enterprise's context and tools, and Earth Care Cloud on Pro.</p>
          <EcnDoor />
        </li>
      </ol>
      <p className="ethics">Earth Care · People Care · Future Care · Fair Share</p>
    </div>
  );
}
