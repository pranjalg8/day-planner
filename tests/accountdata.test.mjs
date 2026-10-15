import test from "node:test";
import assert from "node:assert/strict";
import { validateName, validatePin, validatePinMatch, validateAccount, errorMessage, formatRelativeTime, hasPlannerData, linkNotice, differentAccountText, syncView } from "../accountdata.js";

test("name is trimmed and 2-32 chars", () => {
  assert.equal(validateName("Al"), null);
  assert.equal(validateName("  Al  "), null);
  assert.ok(validateName(" A "));
  assert.ok(validateName(""));
  assert.ok(validateName(undefined));
  assert.equal(validateName("x".repeat(32)), null);
  assert.ok(validateName("x".repeat(33)));
});

test("pin is 4-8 digits only", () => {
  for (const ok of ["1234", "12345678", "0000"]) assert.equal(validatePin(ok), null);
  for (const bad of ["123", "123456789", "12a4", "12 34", "", "١٢٣٤", null]) assert.ok(validatePin(bad), String(bad));
});

test("pins must match; signup checks repeat, signin does not", () => {
  assert.equal(validatePinMatch("1234", "1234"), null);
  assert.ok(validatePinMatch("1234", "1235"));
  assert.deepEqual(validateAccount("signin", { name: "Ann", pin: "1234" }), {});
  assert.deepEqual(Object.keys(validateAccount("signup", { name: "Ann", pin: "1234", pin2: "9999" })), ["pin2"]);
  assert.deepEqual(Object.keys(validateAccount("signup", { name: "A", pin: "12" })).sort(), ["name", "pin"]);
});

test("error messages", () => {
  assert.equal(errorMessage({ code: "name_taken" }), "That name is taken. Try another or sign in.");
  assert.equal(errorMessage({ code: "unauthorized" }), "Name or PIN is wrong.");
  assert.equal(errorMessage({ code: "locked", retryAfterSec: 240 }), "Too many tries. Try again in 4 min.");
  assert.equal(errorMessage({ code: "locked", retryAfterSec: 10 }), "Too many tries. Try again in 1 min.");
  assert.match(errorMessage({ code: "locked" }), /Too many tries/);
  assert.match(errorMessage({ code: "network" }), /^No connection\. You can keep using the app offline/);
  assert.match(errorMessage({ code: "invalid" }), /name 2 to 32/);
  assert.match(errorMessage(new Error("x")), /Something went wrong/);
  assert.ok(errorMessage(null));
});

test("relative time", () => {
  const now = 10_000_000_000;
  assert.equal(formatRelativeTime(now - 5000, now), "just now");
  assert.equal(formatRelativeTime(now + 5000, now), "just now");
  assert.equal(formatRelativeTime(now - 60_000, now), "1 min ago");
  assert.equal(formatRelativeTime(now - 5 * 60_000, now), "5 min ago");
  assert.equal(formatRelativeTime(now - 3 * 3600_000, now), "3 h ago");
  assert.equal(formatRelativeTime(now - 30 * 3600_000, now), "yesterday");
  assert.equal(formatRelativeTime(now - 3 * 86400_000, now), "3 days ago");
  assert.equal(formatRelativeTime(null, now), "never");
  assert.equal(formatRelativeTime(NaN, now), "never");
});

test("hasPlannerData", () => {
  assert.equal(hasPlannerData(["elevate-planner-theme", "day-planner-sync:meta"]), false);
  assert.equal(hasPlannerData(["x", "elevate-planner:plan"]), true);
  assert.equal(hasPlannerData(null), false);
});

test("link notice and different-account text", () => {
  assert.match(linkNotice({ days: 12, hasOtherData: true }), /^This device has 12 days of data\. Signing in adds it to this account/);
  assert.match(linkNotice({ days: 1 }), /1 day of data/);
  assert.match(linkNotice({ days: 0, hasOtherData: true }), /planner data/);
  assert.equal(linkNotice({ days: 0, hasOtherData: false }), null);
  assert.equal(linkNotice(null), null);
  assert.match(differentAccountText("Ann", "Bob"), /^This device is linked to Ann\. To sign in as Bob/);
});

test("syncView maps every state", () => {
  const now = 1_000_000_000;
  assert.equal(syncView(null, false).kind, "unconfigured");
  assert.equal(syncView({ status: "off" }, true).kind, "unconfigured");
  assert.equal(syncView({ status: "signed-out" }, true).text, "Sign in to sync across devices");
  const idle = syncView({ status: "idle", name: "Ann", lastSyncAt: now - 5 * 60_000, pending: 0 }, true, now);
  assert.equal(idle.text, "Signed in as Ann · Last synced 5 min ago");
  assert.equal(idle.chip, "Synced");
  assert.match(syncView({ status: "idle", name: "Ann", lastSyncAt: now, pending: 2 }, true, now).text, /2 changes waiting/);
  assert.equal(syncView({ status: "syncing", name: "Ann" }, true).chip, "Syncing…");
  assert.equal(syncView({ status: "offline", name: "Ann" }, true).kind, "offline");
  const err = syncView({ status: "error", name: "Ann", error: "Boom" }, true);
  assert.equal(err.detail, "Boom");
  assert.equal(err.signedIn, true);
});
