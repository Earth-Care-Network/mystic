/**
 * The one door to the machine. Inside the Tauri shell: the keychain, the
 * ~/Mystic folder, CORS-free HTTP and the updater. In a plain browser (vite dev):
 * localStorage and window.fetch, so the UI can be worked on without the shell.
 */
import type { FetchLike } from "./core/providers";

export const inTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** A phone or tablet build: Mystic there runs on Earth Care Cloud only (an enterprise on Pro). */
export const isMobile =
  typeof navigator !== "undefined" &&
  // iPadOS reports a Mac user agent; a Mac has no touch screen.
  (/iPhone|iPad|iPod|Android/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1)) &&
  (inTauri || /[?&]mobile=1/.test(location.search));

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

const mem = (k: string) => `mystic:${k}`;

export const secrets = {
  async get(name: string): Promise<string | undefined> {
    if (!inTauri) return localStorage.getItem(mem(`secret:${name}`)) ?? undefined;
    return (await invoke<string | null>("secret_get", { name })) ?? undefined;
  },
  async set(name: string, value: string): Promise<void> {
    if (!inTauri) return void localStorage.setItem(mem(`secret:${name}`), value);
    await invoke("secret_set", { name, value });
  },
  async delete(name: string): Promise<void> {
    if (!inTauri) return void localStorage.removeItem(mem(`secret:${name}`));
    await invoke("secret_delete", { name });
  },
};

export const folder = {
  async dir(): Promise<string> {
    return inTauri ? invoke<string>("workspace_dir") : "~/Mystic (browser preview)";
  },
  async read(path: string): Promise<string | null> {
    if (!inTauri) return localStorage.getItem(mem(`ws:${path}`));
    return invoke<string | null>("ws_read", { path });
  },
  async write(path: string, text: string): Promise<void> {
    if (!inTauri) return void localStorage.setItem(mem(`ws:${path}`), text);
    await invoke("ws_write", { path, text });
  },
  async list(dir: string): Promise<string[]> {
    if (!inTauri) {
      const prefix = mem(`ws:${dir}/`);
      return Object.keys(localStorage)
        .filter((k) => k.startsWith(prefix) && !k.slice(prefix.length).includes("/"))
        .map((k) => k.slice(prefix.length))
        .sort();
    }
    return invoke<string[]>("ws_list", { dir });
  },
  async remove(path: string): Promise<void> {
    if (!inTauri) return void localStorage.removeItem(mem(`ws:${path}`));
    await invoke("ws_delete", { path });
  },
  async readJson<T>(path: string, fallback: T): Promise<T> {
    const text = await folder.read(path);
    if (!text) return fallback;
    try {
      return JSON.parse(text) as T;
    } catch {
      return fallback;
    }
  },
  async writeJson(path: string, value: unknown): Promise<void> {
    await folder.write(path, JSON.stringify(value, null, 2));
  },
  async open(): Promise<void> {
    if (!inTauri) return;
    const { openPath } = await import("@tauri-apps/plugin-opener");
    await openPath(await folder.dir());
  },
};

export const httpFetch: FetchLike = async (url, init) => {
  if (!inTauri) return fetch(url, init);
  const { fetch: tauriFetch } = await import("@tauri-apps/plugin-http");
  return tauriFetch(url, init);
};

export async function openUrl(url: string): Promise<void> {
  if (!inTauri) return void window.open(url, "_blank", "noopener");
  const { openUrl } = await import("@tauri-apps/plugin-opener");
  await openUrl(url);
}

/** Starts the one-shot loopback listener; resolves the port and a promise of the callback. */
export async function listenForSignIn(state: string): Promise<{ port: number; callback: Promise<{ code?: string; state?: string; error?: string }> }> {
  if (!inTauri) throw new Error("Sign-in needs the Mystic app. Run it with `bun run app:dev`.");
  const { listen } = await import("@tauri-apps/api/event");
  let resolve!: (v: { code?: string; state?: string; error?: string }) => void;
  const callback = new Promise<{ code?: string; state?: string; error?: string }>((r) => (resolve = r));
  const unlisten = await listen<{ code?: string; state?: string; error?: string }>("oauth-callback", (e) => {
    // Only this sign-in's answer: an older listener's timeout carries its own state.
    if (e.payload.state !== state) return;
    unlisten();
    resolve(e.payload);
  });
  const port = await invoke<number>("oauth_listen", { state });
  return { port, callback };
}

/** Phone sign-in: the OS hands network.earthcare.mystic:/oauth/callback?… back to the app. */
export async function waitForAppLink(prefix: string, state: string, timeoutMs = 10 * 60_000): Promise<URL> {
  const { onOpenUrl } = await import("@tauri-apps/plugin-deep-link");
  return new Promise<URL>((resolve, reject) => {
    let done = false;
    let stop: (() => void) | undefined;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      stop?.();
      reject(new Error("timeout"));
    }, timeoutMs);
    void onOpenUrl((urls) => {
      // Exactly the callback, carrying this sign-in's state: another app or page can't end it.
      const hit = urls.find((u) => {
        const [path, query = ""] = u.split("?");
        return path === prefix && new URLSearchParams(query).get("state") === state;
      });
      if (!hit || done) return;
      done = true;
      clearTimeout(timer);
      stop?.();
      resolve(new URL(hit));
    }).then((unlisten) => {
      stop = unlisten;
      if (done) unlisten();
    });
  });
}

export async function notify(title: string, body: string): Promise<void> {
  if (!inTauri) return;
  const n = await import("@tauri-apps/plugin-notification");
  let granted = await n.isPermissionGranted();
  if (!granted) granted = (await n.requestPermission()) === "granted";
  if (granted) n.sendNotification({ title, body });
}

export type UpdateStatus = { state: "none" | "available" | "downloading" | "ready" | "error"; version?: string; notes?: string; error?: string };

/** Checks the signed release feed. Downloads and installs only when asked. */
export async function checkForUpdate(): Promise<{ status: UpdateStatus; install?: (onProgress: (pct: number) => void) => Promise<void> }> {
  // Phones update through the App Store; the browser preview has nothing to update.
  if (!inTauri || isMobile) return { status: { state: "none" } };
  try {
    const { check } = await import("@tauri-apps/plugin-updater");
    const update = await check();
    if (!update) return { status: { state: "none" } };
    return {
      status: { state: "available", version: update.version, notes: update.body },
      install: async (onProgress) => {
        let total = 0;
        let got = 0;
        await update.downloadAndInstall((e) => {
          if (e.event === "Started") total = e.data.contentLength || 0;
          if (e.event === "Progress") {
            got += e.data.chunkLength;
            if (total) onProgress(Math.round((got / total) * 100));
          }
        });
        const { relaunch } = await import("@tauri-apps/plugin-process");
        await relaunch();
      },
    };
  } catch (err) {
    return { status: { state: "error", error: (err as Error)?.message || "Couldn't check for updates." } };
  }
}
