import { EcnDoor } from "./EcnDoor";
import { Mark } from "./Mark";

/**
 * Mystic on iPhone and iPad runs on Earth Care Cloud: it needs an Earth Care
 * Network sign-in and an enterprise on Pro. Nothing here sells a plan in the app;
 * the enterprise's owner starts Pro on earthcare.network.
 */
export function MobileGate() {
  return (
    <div className="onboarding mobile-gate">
      <div className="hero">
        <Mark big />
        <h1>Mystic</h1>
        <p className="by">by Earth Care Network</p>
        <p className="lede">Your team of AI agents, on Earth Care Cloud.</p>
      </div>
      <div className="gate-card">
        <EcnDoor primary />
      </div>
      <p className="ethics">Earth Care · People Care · Future Care · Fair Share</p>
    </div>
  );
}
