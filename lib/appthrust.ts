import "server-only";
import type { ActorResult, GameMethod } from "./game";

export class BackendError extends Error {
  constructor(public code: string, public status = 502) { super(code); }
}

let cachedToken: { value: string; expiresAt: number } | undefined;
let tokenRequest: Promise<string> | undefined;

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new BackendError("backend_not_configured", 503);
  return value;
}

async function mintToken(): Promise<string> {
  const issuer = required("KEYCLOAK_ISSUER").replace(/\/$/, "");
  const response = await fetch(`${issuer}/protocol/openid-connect/token`, {
    method: "POST", cache: "no-store", signal: AbortSignal.timeout(10_000),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: required("KEYCLOAK_CLIENT_ID"), client_secret: required("KEYCLOAK_CLIENT_SECRET") }),
  });
  if (!response.ok) throw new BackendError("backend_auth_failed", 503);
  const token = await response.json();
  if (typeof token.access_token !== "string" || typeof token.expires_in !== "number" || token.expires_in <= 0) throw new BackendError("backend_auth_failed", 503);
  let expiresAt = Date.now() + token.expires_in * 1000;
  try {
    const claims = JSON.parse(Buffer.from(token.access_token.split(".")[1], "base64url").toString());
    if (typeof claims.exp === "number") expiresAt = Math.min(expiresAt, claims.exp * 1000);
  } catch { /* Opaque tokens can still use the issuer's expires_in. */ }
  cachedToken = { value: token.access_token, expiresAt };
  return token.access_token;
}

async function accessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000) return cachedToken.value;
  tokenRequest ??= mintToken().finally(() => { tokenRequest = undefined; });
  return tokenRequest;
}

async function call(path: string, body: object): Promise<ActorResult> {
  try {
    const base = required("PLATFORM_API_URL").replace(/\/$/, "");
    const project = encodeURIComponent(required("APPTHRUST_PROJECT_ID"));
    const type = encodeURIComponent(process.env.APPTHRUST_ACTOR_TYPE_ID || "connect-four");
    const response = await fetch(`${base}/api/v1/projects/${project}/actor-types/${type}/actors${path}`, {
      method: "POST", cache: "no-store", signal: AbortSignal.timeout(35_000),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${await accessToken()}`, "Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        cachedToken = undefined;
        throw new BackendError("backend_auth_failed", 503);
      }
      throw new BackendError(response.status === 503 ? "actor_unavailable" : "actor_request_failed", response.status === 503 ? 503 : 502);
    }
    const result = await response.json();
    if (typeof result.reply?.ok !== "boolean" || result.reply?.state?.version !== 1 || !Array.isArray(result.reply.state.board) || typeof result.activation?.attempts !== "number" || typeof result.activation?.elapsedMs !== "number" || typeof result.activation?.coldStart !== "boolean") throw new BackendError("invalid_actor_reply");
    return { reply: result.reply, activation: result.activation };
  } catch (error) {
    if (error instanceof BackendError) throw error;
    throw new BackendError("backend_unreachable", 503);
  }
}

export function createActor(actorId: string, method: GameMethod, body: object): Promise<ActorResult> {
  return call("", { actorId, method, body });
}
export function invokeActor(actorId: string, method: GameMethod, body: object): Promise<ActorResult> {
  return call(`/${encodeURIComponent(actorId)}/invoke`, { method, body });
}
