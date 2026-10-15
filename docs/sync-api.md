# Sync API contract

Backend contract for the Day Planner cloud sync (suggested stack: AWS Lambda + API Gateway + DynamoDB). The client is local-first: localStorage is the working copy and this API only stores documents so another browser can sign in (name + PIN) and pull history. Expected scale: 5-10 users.

Reference implementation of every rule below: `syncadapter-mock.js` (in-memory) with tests in `tests/syncadapter.test.mjs`. Client: `syncadapter-http.js`.

## Reusability: tenantId / clientId

The URL has a `{clientId}` segment (`day-planner` for this app). Treat it as the tenant: scope every user, token and document by `clientId`, so other small apps can reuse the same backend by choosing another clientId. Keys and values are opaque to the server (the Day Planner uses keys like `elevate-planner:2026-10-15`, values are JSON strings, but the server must not parse them). The token encodes `tenantId` (= clientId) and `userId`; clients never send either besides the path segment, which must match the token.

## Common

- Base URL: configured client side (`SYNC_BASE_URL`). All bodies are JSON (`Content-Type: application/json`). Errors: `{ "error": "<code>", "message": "<human text>" }`.
- Auth: `Authorization: Bearer <token>` on everything except signup/login. Tokens are opaque (random 256-bit, or signed), expire (suggest 30 days; response field `expiresAt` is **epoch milliseconds**). Invalid or expired token: `401`.
- Timestamps (`updatedAt`) are epoch milliseconds set by the writing device.
- CORS: allow origin `https://pranjalg8.github.io` (and `http://localhost:*` for development), methods `GET, PUT, POST, DELETE, OPTIONS`, headers `Content-Type, Authorization`. No cookies/credentials; answer preflight quickly. Never use `*` together with credentials.
- Limits: at most **25 docs per batch**; a doc `value` is at most **64 KB** (UTF-8 bytes); `key` at most 512 chars; request body at most ~2 MB.

## Endpoints

### POST /v1/{clientId}/auth/signup
Request `{ "name": "Alice", "pin": "1234" }`. Name: 2-32 chars after trim, unique per clientId case-insensitively. PIN: string of 4-8 digits.
- `201 { "token", "expiresAt", "name" }` (name as typed, trimmed)
- `400 invalid` (bad name/PIN), `409 name_taken`, `429 locked`

### POST /v1/{clientId}/auth/login
Same request. 
- `200 { "token", "expiresAt", "name" }`
- `401 unauthorized` with the **same generic message "Name or PIN is wrong"** for unknown name and wrong PIN (never reveal whether the name exists; do the same amount of hashing work for unknown names)
- `429 { "error": "locked", "retryAfterSec": 300 }` while locked. Also send `Retry-After`.

### PUT /v1/{clientId}/docs/batch
Bearer. Request `{ "docs": [ { "key", "value", "updatedAt", "deviceId", "deleted"? } ] }` (<= 25).
Tombstone: `deleted: true` (value may be `""`; keep the row so deletions propagate).
Per doc acceptance rule: accept if there is no stored doc, or `doc.updatedAt > stored.updatedAt`, or (`doc.updatedAt == stored.updatedAt` and `doc.updatedAt > 0` and `doc.deviceId > stored.deviceId` as a string compare). An `updatedAt` of 0 marks a *legacy* doc from a device that never synced; it is accepted only when nothing is stored for the key and must never overwrite anything. The deviceId tie-break makes all devices agree on equal timestamps.
- `200 { "accepted": [ { "key", "serverUpdatedAt" } ], "rejected": [ { "key", "reason", "current" } ] }`
  - `serverUpdatedAt` is the stored `updatedAt` (equal to the doc's).
  - Rejected for staleness: `reason: "stale"`, `current` = the stored doc (`{key,value,updatedAt,deviceId,deleted?}`).
  - Invalid doc or too large: `reason: "invalid"` or `"too_large"`, `current: null`.
- Each accepted doc is stamped with a server-assigned, per-user, strictly increasing `serverSeq` (used for the cursor).
- `400 invalid` for more than 25 docs / malformed body, `401`.

### GET /v1/{clientId}/docs?cursor=<opaque>&limit=200
Bearer. Returns docs whose `serverSeq` is greater than the cursor (all docs when `cursor` is absent), ordered by `serverSeq`, at most `limit` (1-200, default 200). Include tombstones.
- `200 { "docs": [ {key,value,updatedAt,deviceId,deleted?} ], "cursor": "<opaque>", "hasMore": true|false }`
- `cursor` is the position after the last returned doc (or the request cursor if none). The client stores it and sends it next time. Do not expose `serverSeq` in docs. Invalid cursor: `400`.

### DELETE /v1/{clientId}/account/data
Bearer. Deletes all of the user's documents (the account and PIN stay). `204`. The seq counter must keep increasing.

## PIN hashing and lockout

- Never store or log the PIN. Store a per-user random salt (>= 16 bytes) plus a slow hash: scrypt/argon2id, or PBKDF2-HMAC-SHA256 with >= 100k iterations (Lambda: Node `crypto.scrypt` is fine). Compare in constant time.
- A 4-8 digit PIN is weak by nature, so lockout is the real protection: after 5 consecutive wrong attempts for a (clientId, name) lock it for 5 minutes (`429 locked`, `retryAfterSec`). A correct PIN during the lock still gets 429. Count attempts for unknown names too. Reset the counter on success. Keep counters in DynamoDB (conditional/atomic updates, optional TTL), not in Lambda memory. Consider additional per-IP throttling at API Gateway.
- Signup may reveal that a name is taken (unavoidable); login must not.

## DynamoDB design suggestion

Single table `planner-sync`, on-demand billing:

| Item | PK | SK | Attributes |
|---|---|---|---|
| user | `USER#{tenant}#{nameLower}` | `PROFILE` | userId, displayName, salt, pinHash, params, failedCount, lockedUntil, docSeq |
| doc | `DOC#{tenant}#{userId}` | `{collection}#{key}` (collection = key prefix before first `:`, else `_`) | value, updatedAt, deviceId, deleted, serverSeq, ttl? |
| token | `TOKEN#{tokenHash}` | `T` | tenant, userId, expiresAt, ttl (DynamoDB TTL) |

- Name uniqueness: `PutItem` on the USER item with `attribute_not_exists(PK)`.
- Acceptance rule: conditional `PutItem`/`UpdateItem` with condition `attribute_not_exists(PK) OR updatedAt < :u OR (updatedAt = :u AND :u > 0 AND deviceId < :d)`; on `ConditionalCheckFailedException` return the stored item (`ReturnValuesOnConditionCheckFailure: ALL_OLD`) as `current`.
- Server sequence: atomically `ADD docSeq 1` on the USER item (one `UpdateItem` per accepted doc, or reserve N for a batch) and store the result as `serverSeq` on the doc.
- Cursor: add GSI `by-seq` with PK = `DOC#{tenant}#{userId}` (the doc partition) and SK = `serverSeq` (number). Query `serverSeq > :cursor` with `Limit` = page size, ascending. The opaque cursor can simply be `base64("s" + lastSeq)`. (With <= 10 users and small history a Query on the main partition filtered by seq also works.)
- Store tokens hashed (sha-256), never the raw token.

## Client behaviour worth knowing

- The client pushes at most 25 docs per call (debounced ~20 s after changes, on page hide, on reconnect) and pulls with the cursor; it merges last-writer-wins by `(updatedAt, deviceId)`. It never sends or stores the PIN after signup/login; only the token.
- Network / 5xx errors are retried with exponential backoff (cap 5 min). `401` signs the user out locally but keeps local data.
