# Connect Four — AppThrust Play Lab

A phone-friendly Connect Four game for the Tokyo Game Show booth. Two visitors
join a queue, get a private match actor, and play on a live 7 × 6 board. A TV wall
shows the matches created by this app process. English UI with light Japanese
subtitles; no account, database, or browser-side Platform credentials.

## Run locally

Use Node.js 24 and npm:

```sh
npm ci
ACTOR_BACKEND=mock npm run dev
```

Open `http://localhost:3000`. Use **two separate browser profiles/private sessions**
to play both seats; two tabs in the same profile share a player cookie. `/wall`
is the big-screen view. For another port:

```sh
ACTOR_BACKEND=mock npm run dev -- --port 3097
```

The mock is a development-only, in-memory implementation of the actor methods.
It deliberately delays its first call by approximately 1.2 seconds so the waiting
screen can be exercised. The UI labels mock timings as a **local simulation**.
`NODE_ENV=production` rejects `ACTOR_BACKEND=mock`; it cannot silently replace a
real actor in production.

## Environment

Copy `.env.example` to `.env.local` for local configuration. Supply production
values as runtime environment variables/secrets, never build arguments or
`NEXT_PUBLIC_*` values. No credentials are needed to build the app.

| Variable | Meaning |
| --- | --- |
| `ACTOR_BACKEND` | `platform-api` (default), or `mock` in development only. |
| `PLATFORM_API_URL` | Platform API **origin**, for example `https://dashboard.appthrust.dev`. Do not append `/api/v1`. |
| `APPTHRUST_PROJECT_ID` | Existing project containing the ActorType. Required for Platform mode. |
| `APPTHRUST_ACTOR_TYPE_ID` | Existing ActorType serving the Connect Four fixture; defaults to `connect-four`. |
| `KEYCLOAK_ISSUER` | Realm issuer, for example `https://iam.appthrust.dev/realms/appthrust`. |
| `KEYCLOAK_CLIENT_ID` | Confidential service-account client with project actor write access. |
| `KEYCLOAK_CLIENT_SECRET` | Client secret, supplied through the deployment's secret facility. |
| `PORT` | HTTP listen port; defaults to `3000`. |

The same client-credentials JWT must be accepted by **both** Platform API and the
actor gateway (their audience/authorized-party requirements). Provision that
client separately; this app neither creates clients nor expands permissions.
Platform API must have its actor gateway URL and namespace configured.

## How matches map to actors

```text
Phone → Next.js route handler → Platform API → actor gateway → match actor
```

1. `proxy.ts` issues an httpOnly `c4pid` cookie on the first visit. It is
   SameSite=Lax and Secure on HTTPS, including TLS terminated by a trusted proxy.
   The ingress must preserve the public Host and set/overwrite X-Forwarded-Proto.
2. The single-process queue reserves two different players synchronously. It
   allocates `match-<n>` using a counter initialized with `Date.now() % 100000`.
3. `lib/appthrust.ts` mints a Keycloak `client_credentials` token server-side,
   reusing it until 60 seconds before expiry. Concurrent token requests share
   one in-flight mint. Token and upstream response bodies are never logged.
4. Player one is seated by
   `POST /api/v1/projects/{project}/actor-types/{type}/actors`, with
   `{actorId, method:"join", body:{player,name}}`. Player two joins via
   `POST .../actors/{id}/invoke`, with `{method:"join", body:{player,name}}`.
   **Both** routes get a fresh UUID `Idempotency-Key`.
5. Platform API owns activation retry/backoff. The app waits for its bounded
   response; it does not retry game mutations. The queue shows real elapsed time
   while starting, then actual `attempts`, `elapsedMs`, and `coldStart` from the
   response. Retry-attempt counts cannot be streamed by the current API, so the
   waiting UI never invents them.
6. Every move and state read runs through the actor. State has six rows with
   **row zero at the bottom**, seven columns numbered 0–6, and seats 1/2. The
   actor owns gravity, turn order, four-in-a-row detection, draw, and reset.
   The frontend does not optimistically decide a move or winner.

The actor card keeps creation/activation timings separate from the last call
and last turn, so an 800 ms state poll does not erase the cold-start story.
Polling continues after a round ends so both players observe a rematch reset.
The wall polls the app's **last-known snapshots** every 2 seconds; it does not
wake all actors just to render the TV.

## Game HTTP routes

All routes are same-origin, JSON, and `Cache-Control: no-store`.

| Route | Request / response |
| --- | --- |
| `POST /api/queue` | `{name}` (trimmed, 1–24 characters) → queue status. Repeated requests while queued/playing preserve the existing reservation. |
| `GET /api/queue` | `idle`, `waiting`, `spawning`, `matched`, or `error`; includes elapsedMs, and matchId/seat when reserved. Matched replies contain state and creation activation. |
| `GET /api/match/{id}` | Invokes `state`; returns actor reply plus matchId, seat (0 for spectator), activation, creation, lastTurnMs, backend. |
| `POST /api/match/{id}/drop` | `{column}` → invokes `drop` with the cookie's player ID, not an ID supplied by the browser. |
| `POST /api/match/{id}/reset` | Invokes `reset`; keeps both players. Only seated players may mutate a match. |
| `GET /api/wall` | `{total, backend, matches}`; each match contains state, activation, creation, lastTurnMs, and createdAt. |

Actor `ok:false` maps to HTTP **409**, preserving its error code, state, and
activation. Game codes are `bad_request`, `match_full`, `not_playing`,
`unknown_player`, `not_your_turn`, `bad_column`, and `column_full`.
Malformed/oversized app JSON is 400 (`bad_request`); an invalid name is 400
(`bad_name`). A different browser origin is 403 (`cross_origin_request`), and a
match outside this process's directory is 404 (`match_not_found`). Backend
failures use sanitized 502/503 codes rather than exposing credentials or raw
upstream messages. Before an actor responds, state/activation are null.

## Booth deployment boundary

Build this repository as one AppThrust Application component using `Dockerfile`.
It follows `appthrust/sample-payment`: Node 24 slim dependency/build/runtime
stages, `npm ci`, Next.js standalone output, copied public/static assets, and a
non-root runtime user. The container starts `node server.js` on `0.0.0.0:3000`.

**Run exactly one instance.** Matchmaking, the actor directory, and the TV index
live in memory. Inactive unmatched queue entries expire after 45 seconds without
polling. The directory retains this process's matches for the booth session.
A restart loses that directory even if Platform actors retain their own state;
this app does not rediscover old actors. The specified modulo-seeded counter is
not a globally unique ID allocator: coordinate one process and do not restart
into an existing ID range. This is a booth demo, not a multi-tenant matchmaking
service or a hardened public identity system.

## Verification

```sh
npm ci
npm run lint
npm run build
```

ESLint 9 is used because Next's current React/import/accessibility plugins still
require that major; npm may report its upstream deprecation. npm 11 may also
report a pending optional `unrs-resolver` install script. The checked installation,
lint, and standalone build do not require approving that script.

With the mock server running, use separate cookie jars (curl and jq):

```sh
BASE=http://localhost:3097
curl -sS -b p1.cookies -c p1.cookies -H 'Content-Type: application/json' \
  -d '{"name":"Reo"}' "$BASE/api/queue"
curl -sS -b p2.cookies -c p2.cookies -H 'Content-Type: application/json' \
  -d '{"name":"Aki"}' "$BASE/api/queue"
# Poll each until status == "matched"; both must have the same matchId, seats 1/2.
curl -sS -b p1.cookies "$BASE/api/queue"
curl -sS -b p2.cookies "$BASE/api/queue"
MATCH=$(curl -sS -b p1.cookies "$BASE/api/queue" | jq -r .matchId)
# Alternate p1 column 0, p2 column 1, three times; then p1 column 0 wins vertically.
for turn in 1 2 3; do
  curl -sS -b p1.cookies -H 'Content-Type: application/json' -d '{"column":0}' "$BASE/api/match/$MATCH/drop"
  curl -sS -b p2.cookies -H 'Content-Type: application/json' -d '{"column":1}' "$BASE/api/match/$MATCH/drop"
done
curl -sS -b p1.cookies -H 'Content-Type: application/json' -d '{"column":0}' "$BASE/api/match/$MATCH/drop"
curl -sS "$BASE/api/wall"
curl -sS -b p1.cookies -H 'Content-Type: application/json' -d '{}' "$BASE/api/match/$MATCH/reset"
```

A win has `status:"won"`, `winner:1`, `next:0`, and four winningCells.
Reset has zero moves, no lastMove, an empty board, and the original two seats.
Delete the local cookie jars after the smoke run; do not commit them.
