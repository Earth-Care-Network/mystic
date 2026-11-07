/**
 * Earth Care Network sign-in and Earth Care Cloud.
 *
 * Sign-in is the OAuth door every native MCP client uses (RFC 7591 dynamic
 * registration, PKCE S256, an http loopback redirect on any port, RFC 8252):
 * Mystic gets an `ecn_at_` access token and a rotating `ecn_rt_` refresh token,
 * kept in the OS keychain. The same token opens the ECN MCP server for local
 * agents and, for an enterprise on Pro, the cloud run on Jaguar.
 */
import type { AguiEvent } from "./agui";
import type { FetchLike } from "./providers";
import { readSse } from "./sse";

export const ECN_ORIGINS = {
  production: "https://www.earthcare.network",
  test: "https://test.earthcare.network",
} as const;

export const SCOPES = "read build";

/** Servers Mystic sends a sign-in to: Earth Care Network, TEST, and the one this build was made for. */
export function isKnownOrigin(origin: string): boolean {
  const extra = (import.meta as { env?: Record<string, string | undefined> }).env?.VITE_ECN_ORIGIN;
  return (Object.values(ECN_ORIGINS) as string[]).includes(origin) || (!!extra && origin === extra);
}

/** Desktop: a loopback listener on any port (RFC 8252 §7.3). */
export const DESKTOP_REDIRECT_BASE = "http://127.0.0.1/callback";
export const loopbackRedirect = (port: number) => `http://127.0.0.1:${port}/callback`;
/** Phone: the app's own private-use scheme, handed back by the OS (RFC 8252 §7.1). */
export const MOBILE_REDIRECT = "network.earthcare.mystic:/oauth/callback";

/** Earth Care Network's MCP address: `/mcp` on the public hosts, `/mcp/` on a server reached directly. */
export function mcpUrl(origin: string): string {
  const host = (() => {
    try {
      return new URL(origin).hostname;
    } catch {
      return "";
    }
  })();
  const direct = host === "localhost" || host === "127.0.0.1" || host.endsWith(".up.railway.app");
  return `${origin.replace(/\/+$/, "")}/mcp${direct ? "/" : ""}`;
}
export const CLIENT_NAME = "Mystic by Earth Care Network";

export type OAuthMeta = { authorization_endpoint: string; token_endpoint: string; registration_endpoint: string };
export type Tokens = { access_token: string; refresh_token?: string; expires_at: number; scope?: string };

export type Enterprise = {
  organization_id: string;
  slug: string;
  name: string;
  role: string;
  tier: string;
  trial_days_left: number | null;
  cloud: boolean;
  reason: "pro" | "requires_pro" | "seat";
  /** The enterprise's Mystic Cloud workspace (OpenDuet), when Earth Care Network offers them. */
  workspace?: Workspace | null;
};
export type Workspace = { status: "requested" | "provisioning" | "live" | "suspended" | "failed"; url: string; requested_at: string | null };
export type Me = { user: { id: number; email: string; name: string }; enterprises: Enterprise[]; cloud: boolean; upgrade_path: string };

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function pkcePair(): Promise<{ verifier: string; challenge: string }> {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  return { verifier, challenge: b64url(digest) };
}

export function randomState(): string {
  return b64url(crypto.getRandomValues(new Uint8Array(16)));
}

export async function discover(origin: string, fetchImpl: FetchLike): Promise<OAuthMeta> {
  const res = await fetchImpl(`${origin}/.well-known/oauth-authorization-server`, { method: "GET", headers: { accept: "application/json" } });
  if (!res.ok) throw new Error("Couldn't reach Earth Care Network's sign-in. Check your connection.");
  const meta = (await res.json()) as OAuthMeta & { issuer?: string };
  // RFC 8414 §3.3: the issuer is the server asked, and every endpoint lives there too.
  const base = origin.replace(/\/+$/, "");
  const same = (u: string) => {
    try {
      return new URL(u).origin === new URL(base).origin;
    } catch {
      return false;
    }
  };
  if ((meta.issuer && meta.issuer.replace(/\/+$/, "") !== base) || ![meta.authorization_endpoint, meta.token_endpoint, meta.registration_endpoint].every(same))
    throw new Error("That server's sign-in points somewhere else, so Mystic stopped.");
  return meta;
}

/** Registers once per install; the server reuses a public client with the same name and callback. */
export async function register(meta: OAuthMeta, fetchImpl: FetchLike, redirectUri: string = DESKTOP_REDIRECT_BASE): Promise<string> {
  const res = await fetchImpl(meta.registration_endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: CLIENT_NAME,
      redirect_uris: [redirectUri],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      scope: SCOPES,
    }),
  });
  if (!res.ok) throw new Error("Earth Care Network didn't register Mystic. Try again in a minute.");
  return ((await res.json()) as { client_id: string }).client_id;
}

export function authorizeUrl(meta: OAuthMeta, p: { clientId: string; redirectUri: string; challenge: string; state: string }): string {
  const q = new URLSearchParams({
    response_type: "code",
    client_id: p.clientId,
    redirect_uri: p.redirectUri,
    code_challenge: p.challenge,
    code_challenge_method: "S256",
    scope: SCOPES,
    state: p.state,
  });
  return `${meta.authorization_endpoint}?${q}`;
}

/** The server's own reason, for the one sentence the person reads. */
async function oauthReason(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string; error_description?: string };
    const why = body.error_description || body.error;
    return why ? ` (${String(why).replace(/\.$/, "")})` : "";
  } catch {
    return "";
  }
}

function toTokens(json: any): Tokens {
  return {
    access_token: json.access_token,
    refresh_token: json.refresh_token,
    scope: json.scope,
    expires_at: Date.now() + Math.max(60, Number(json.expires_in || 3600) - 60) * 1000,
  };
}

export async function exchangeCode(
  meta: OAuthMeta,
  p: { clientId: string; code: string; verifier: string; redirectUri: string },
  fetchImpl: FetchLike,
): Promise<Tokens> {
  const res = await fetchImpl(meta.token_endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: p.code,
      code_verifier: p.verifier,
      client_id: p.clientId,
      redirect_uri: p.redirectUri,
    }).toString(),
  });
  if (!res.ok) throw new Error(`Sign-in didn't finish${await oauthReason(res)}. Start it again from Settings · Earth Care Network.`);
  return toTokens(await res.json());
}

export async function refresh(meta: OAuthMeta, clientId: string, refreshToken: string, fetchImpl: FetchLike): Promise<Tokens> {
  const res = await fetchImpl(meta.token_endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: clientId }).toString(),
  });
  if (!res.ok) throw new Error("Your Earth Care Network sign-in ended. Sign in again from Settings · Earth Care Network.");
  const t = toTokens(await res.json());
  return { ...t, refresh_token: t.refresh_token || refreshToken };
}

export async function me(origin: string, token: string, fetchImpl: FetchLike): Promise<Me | { off: true }> {
  const res = await fetchImpl(`${origin}/api/v1/mystic/me/`, { method: "GET", headers: { authorization: `Bearer ${token}`, accept: "application/json" } });
  if (res.status === 404) return { off: true };
  if (res.status === 401) throw new Error("Your Earth Care Network sign-in ended. Sign in again from Settings · Earth Care Network.");
  if (!res.ok) throw new Error(`Earth Care Network answered HTTP ${res.status}.`);
  return (await res.json()) as Me;
}

export type CloudRunInput = {
  threadId: string;
  runId: string;
  organizationId: string;
  /** The Earth Care Network thread from an earlier cloud turn, so Jaguar keeps one conversation. */
  ecnThreadId?: string;
  messages: { id: string; role: "user" | "assistant"; content: string }[];
};

/** A turn on Jaguar for a Pro enterprise; yields the same AG-UI events the local loop does. */
export async function* cloudRun(origin: string, token: string, input: CloudRunInput, fetchImpl: FetchLike, signal?: AbortSignal): AsyncGenerator<AguiEvent> {
  const res = await fetchImpl(`${origin}/api/v1/mystic/cloud/run/`, {
    method: "POST",
    signal,
    headers: { "content-type": "application/json", accept: "text/event-stream", authorization: `Bearer ${token}` },
    body: JSON.stringify({
      threadId: input.threadId,
      runId: input.runId,
      messages: input.messages,
      state: {},
      tools: [],
      context: [],
      forwardedProps: { organization_id: input.organizationId, ...(input.ecnThreadId ? { thread_id: input.ecnThreadId } : {}) },
    }),
  });
  if (!res.ok || !res.body) {
    let detail = `Earth Care Cloud answered HTTP ${res.status}.`;
    let code: string | undefined;
    try {
      const body = (await res.json()) as { detail?: string; error?: string };
      detail = body.detail || detail;
      code = body.error;
    } catch {
      /* not JSON */
    }
    yield { type: "RUN_ERROR", message: detail, code };
    return;
  }
  for await (const msg of readSse(res.body)) {
    try {
      const e = JSON.parse(msg.data) as AguiEvent;
      if (e && typeof e.type === "string") yield e;
    } catch {
      /* a keep-alive or a line we don't draw */
    }
  }
}

/** The card Jaguar queued in a cloud turn: its ToolProposal id rides in the arguments. */
export function cardProposal(args: string): { proposalId: string; args: Record<string, unknown> } | null {
  try {
    const parsed = JSON.parse(args || "{}") as Record<string, unknown>;
    const id = typeof parsed.suggestion_id === "string" ? parsed.suggestion_id : "";
    return id ? { proposalId: id, args: parsed } : null;
  } catch {
    return null;
  }
}

/** Yes on a queued card: Jaguar's own door runs it (only with its proposal id). */
export async function approveCard(
  origin: string,
  token: string,
  p: { organizationId: string; tool: string; args: Record<string, unknown>; proposalId: string },
  fetchImpl: FetchLike,
): Promise<string> {
  const res = await fetchImpl(`${origin}/api/v1/mystic/cloud/approve/`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ organization_id: p.organizationId, tool_name: p.tool, arguments: p.args, proposal_id: p.proposalId }),
  });
  const body = (await res.json().catch(() => ({}))) as { detail?: string; message?: string; result?: unknown };
  if (!res.ok) throw new Error(body.detail || `Earth Care Network answered HTTP ${res.status}.`);
  const r = body.result as { message?: string; summary?: string } | undefined;
  return r?.message || r?.summary || body.message || "Done.";
}

/** Refuse on a queued card: nothing runs, and Earth Care Network keeps the decision. */
export async function declineCard(
  origin: string,
  token: string,
  p: { organizationId: string; threadId: string; proposalId: string },
  fetchImpl: FetchLike,
): Promise<void> {
  const res = await fetchImpl(`${origin}/api/v1/mystic/cloud/decline/`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ organization_id: p.organizationId, thread_id: p.threadId, proposal_id: p.proposalId }),
  });
  if (!res.ok && res.status !== 409) {
    const body = (await res.json().catch(() => ({}))) as { detail?: string };
    throw new Error(body.detail || `Earth Care Network answered HTTP ${res.status}.`);
  }
}

/** An owner or admin turns on the enterprise's Mystic Cloud workspace (one per enterprise). */
export async function requestWorkspace(origin: string, token: string, organizationId: string, fetchImpl: FetchLike): Promise<Workspace> {
  const res = await fetchImpl(`${origin}/api/v1/mystic/workspace/`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ organization_id: organizationId }),
  });
  const body = (await res.json().catch(() => ({}))) as { workspace?: Workspace; detail?: string };
  if (!res.ok || !body.workspace) throw new Error(body.detail || `Earth Care Network answered HTTP ${res.status}.`);
  return body.workspace;
}
