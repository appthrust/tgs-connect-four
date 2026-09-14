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

// dashboard.appthrust.dev closes requests at its 15 s edge timeout (504
// "upstream request timeout"), while a cold or re-activated actor can take
// longer (fresh ≈6 s, re-activation after idle up to ≈40 s observed). Retry the
// same logical operation with the SAME Idempotency-Key so a call that
// completed server-side is replayed instead of re-executed (a second `drop`
// would otherwise be rejected as not_your_turn).
const ATTEMPT_TIMEOUT_MS = 20_000;
const TOTAL_BUDGET_MS = 75_000;
const RETRY_DELAY_MS = 1_000;

async function call(path: string, body: object): Promise<ActorResult> {
  const base = required("PLATFORM_API_URL").replace(/\/$/, "");
  const project = encodeURIComponent(required("APPTHRUST_PROJECT_ID"));
  const type = encodeURIComponent(process.env.APPTHRUST_ACTOR_TYPE_ID || "connect-four");
  const url = `${base}/api/v1/projects/${project}/actor-types/${type}/actors${path}`;
  const payload = JSON.stringify(body);
  const idempotencyKey = crypto.randomUUID();
  const startedAt = Date.now();
  let lastError: BackendError = new BackendError("backend_unreachable", 503);
  while (true) {
    let response: Response | undefined;
    try {
      response = await fetch(url, {
        method: "POST", cache: "no-store", signal: AbortSignal.timeout(ATTEMPT_TIMEOUT_MS),
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${await accessToken()}`, "Idempotency-Key": idempotencyKey },
        body: payload,
      });
    } catch (error) {
      if (error instanceof BackendError) throw error;
      lastError = new BackendError("backend_unreachable", 503);
    }
    if (response) {
      if (response.ok) {
        const result = await response.json();
        if (typeof result.reply?.ok !== "boolean" || result.reply?.state?.version !== 1 || !Array.isArray(result.reply.state.board) || typeof result.activation?.attempts !== "number" || typeof result.activation?.elapsedMs !== "number" || typeof result.activation?.coldStart !== "boolean") throw new BackendError("invalid_actor_reply");
        return { reply: result.reply, activation: result.activation };
      }
      if (response.status === 401 || response.status === 403) {
        cachedToken = undefined;
        throw new BackendError("backend_auth_failed", 503);
      }
      // 409 with the same key means the first attempt is still running
      // server-side after the edge dropped our connection; keep polling it.
      if (response.status !== 409 && response.status !== 502 && response.status !== 503 && response.status !== 504) throw new BackendError("actor_request_failed", 502);
      lastError = new BackendError(response.status === 503 || response.status === 409 ? "actor_unavailable" : "actor_request_failed", response.status === 503 || response.status === 409 ? 503 : 502);
    }
    if (Date.now() - startedAt + RETRY_DELAY_MS >= TOTAL_BUDGET_MS) throw lastError;
    const { promise, resolve } = Promise.withResolvers<void>();
    setTimeout(resolve, RETRY_DELAY_MS);
    await promise;
  }
}

export function createActor(actorId: string, method: GameMethod, body: object): Promise<ActorResult> {
  return call("", { actorId, method, body });
}
export function invokeActor(actorId: string, method: GameMethod, body: object): Promise<ActorResult> {
  return call(`/${encodeURIComponent(actorId)}/invoke`, { method, body });
}
