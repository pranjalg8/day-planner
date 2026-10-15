// fetch-based adapter for the HTTP contract in docs/sync-api.md.
import { SYNC_BASE_URL, CLIENT_ID } from "./syncconfig.js";
import { syncError } from "./syncstore.js";

export function createHttpAdapter({ baseUrl = SYNC_BASE_URL, clientId = CLIENT_ID, fetchImpl, timeoutMs = 20000 } = {}) {
  const root = `${String(baseUrl).replace(/\/+$/, "")}/v1/${encodeURIComponent(clientId)}`;

  async function call(method, path, { token, body, generic401 } = {}) {
    const doFetch = fetchImpl || globalThis.fetch;
    const headers = { Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (token) headers.Authorization = `Bearer ${token}`;
    let ctl = null, timer = null;
    if (typeof AbortController !== "undefined") { ctl = new AbortController(); timer = setTimeout(() => ctl.abort(), timeoutMs); }
    let res;
    try {
      res = await doFetch(root + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: ctl ? ctl.signal : undefined, credentials: "omit" });
    } catch {
      throw syncError("network", "Can't reach the sync server");
    } finally { if (timer) clearTimeout(timer); }
    let data = null;
    if (res.status !== 204) { try { data = await res.json(); } catch { data = null; } }
    const msg = data && typeof data.message === "string" ? data.message : null;
    if (res.status >= 200 && res.status < 300) {
      if (res.status !== 204 && (data === null || typeof data !== "object")) throw syncError("network", "Unexpected response from the sync server");
      return data;
    }
    switch (res.status) {
      case 400: case 413: throw syncError("invalid", msg || "Invalid request");
      case 401: case 403: throw syncError("unauthorized", generic401 ? "Name or PIN is wrong" : msg || "Session expired");
      case 409: throw syncError("name_taken", msg || "That name is already taken");
      case 429: {
        let retry = data && Number(data.retryAfterSec);
        if (!Number.isFinite(retry)) retry = Number(res.headers && res.headers.get && res.headers.get("Retry-After"));
        throw syncError("locked", msg || "Too many attempts. Try again later.", { retryAfterSec: Number.isFinite(retry) ? retry : 300 });
      }
      default: throw syncError("network", "The sync server is unavailable");
    }
  }

  return {
    signup: (name, pin) => call("POST", "/auth/signup", { body: { name, pin } }),
    login: (name, pin) => call("POST", "/auth/login", { body: { name, pin }, generic401: true }),
    putDocs: (token, docs) => call("PUT", "/docs/batch", { token, body: { docs } }),
    getDocs: (token, cursor, limit = 200) => {
      const q = new URLSearchParams({ limit: String(limit) });
      if (cursor) q.set("cursor", cursor);
      return call("GET", `/docs?${q}`, { token });
    },
    async deleteAccountData(token) { await call("DELETE", "/account/data", { token }); },
  };
}
