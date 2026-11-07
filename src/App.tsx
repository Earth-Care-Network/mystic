import { useEffect, useState } from "react";
import { engine } from "./engine";
import { checkForUpdate, isMobile } from "./platform";
import { MobileGate } from "./ui/MobileGate";
import { AgentPanel } from "./ui/AgentPanel";
import { ChatView } from "./ui/Chat";
import { useEngine } from "./ui/hooks";
import { SettingsView } from "./ui/Settings";
import { Onboarding } from "./ui/Onboarding";

type View = { kind: "chat"; agentId: string } | { kind: "settings"; tab?: string };

export function App() {
  const e = useEngine();
  const [loaded, setLoaded] = useState(false);
  const [view, setView] = useState<View>({ kind: "chat", agentId: "chief-of-staff" });
  const [panel, setPanel] = useState(false);
  const [navOpen, setNavOpen] = useState(false);

  const [update, setUpdate] = useState<string | null>(null);

  useEffect(() => {
    void engine.load().then(() => setLoaded(true));
    // Like Hermes Desktop: look for a signed release at launch, install only on a yes.
    void checkForUpdate().then((r) => r.status.state === "available" && setUpdate(r.status.version || "new"));
  }, []);

  if (!loaded) return <div className="splash">Mystic</div>;
  // On a phone, Mystic runs only on Earth Care Cloud: a sign-in and an enterprise on Pro.
  if (isMobile && !e.hasUsableModel()) return <MobileGate />;
  // Onboarding until Mystic can actually run something: a key, or an enterprise on Pro.
  if (!e.hasUsableModel()) return <Onboarding onDone={() => setView({ kind: "chat", agentId: "chief-of-staff" })} />;

  const agent = view.kind === "chat" ? e.agents.find((a) => a.id === view.agentId) || e.agents[0] : undefined;
  const signedIn = e.me && !("off" in e.me);

  return (
    <div className={`shell ${navOpen ? "nav-open" : ""}`}>
      <button className="nav-toggle ghost" aria-label={navOpen ? "Close your team" : "Open your team"} aria-expanded={navOpen} onClick={() => setNavOpen((o) => !o)}>
        ☰
      </button>
      <aside className="sidebar" onClick={(ev) => (ev.target as HTMLElement).closest("button") && setNavOpen(false)}>
        <div className="brand" data-tauri-drag-region>
          <span className="mark" aria-hidden /> Mystic
        </div>
        <nav aria-label="Your agents">
          <div className="label">Your team</div>
          {e.agents.map((a) => (
            <button key={a.id} className={`agent-row ${agent?.id === a.id ? "active" : ""}`} onClick={() => setView({ kind: "chat", agentId: a.id })}>
              <span className="avatar">{a.name.slice(0, 1)}</span>
              <span className="who">
                <span className="name">{a.name}</span>
                <span className="sub">{e.busy.has(a.id) ? "Working…" : a.model.providerId === "ecn-cloud" ? "Earth Care Cloud" : a.model.model}</span>
              </span>
            </button>
          ))}
        </nav>
        <div className="foot">
          <button className="link" onClick={() => setView({ kind: "settings", tab: "routines" })}>
            Routines {e.routines.length ? `· ${e.routines.length}` : ""}
          </button>
          <button className="link" onClick={() => setView({ kind: "settings", tab: "cloud" })}>
            {signedIn ? `Earth Care Network · ${(e.me as any).user.name}` : "Sign in to Earth Care Network"}
          </button>
          <button className="link" onClick={() => setView({ kind: "settings" })}>
            Settings
          </button>
        </div>
      </aside>
      <main className="main">
        {update ? (
          <div className="update-bar" role="status">
            Mystic {update} is ready.
            <button className="link" onClick={() => setView({ kind: "settings", tab: "updates" })}>
              Install
            </button>
            <button className="link" onClick={() => setUpdate(null)}>
              Later
            </button>
          </div>
        ) : null}
        {view.kind === "settings" ? (
          <SettingsView tab={view.tab} />
        ) : agent ? (
          <ChatView agent={agent} onOpenPanel={() => setPanel((p) => !p)} panelOpen={panel} onSettings={(tab) => setView({ kind: "settings", tab })} />
        ) : null}
      </main>
      {view.kind === "chat" && agent && panel ? <AgentPanel agent={agent} onClose={() => setPanel(false)} onDeleted={() => setView({ kind: "chat", agentId: "chief-of-staff" })} /> : null}
    </div>
  );
}
