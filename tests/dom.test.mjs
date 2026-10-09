import test from "node:test";
import assert from "node:assert/strict";

// Minimal DOM stub: just enough surface for el().
class Node_ {
  constructor(tag) { this.tag = tag; this.attrs = {}; this.children = []; this.listeners = {}; this.className = ""; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  addEventListener(t, f) { this.listeners[t] = f; }
  appendChild(c) { this.children.push(c); return c; }
}
globalThis.document = { createElement: (t) => new Node_(t), createTextNode: (text) => ({ text }) };
const { el } = await import("../dom.js");

test("el: class, attributes and skipped values", () => {
  const n = el("div", { class: "a b", id: "x", hidden: null, title: undefined, disabled: false, "data-n": 0 });
  assert.equal(n.className, "a b");
  assert.deepEqual(n.attrs, { id: "x", "data-n": "0" });
});

test("el: on* functions become listeners, value is a property", () => {
  const f = () => {};
  const n = el("input", { onclick: f, value: "7" });
  assert.equal(n.listeners.click, f);
  assert.equal(n.value, "7");
  assert.equal("value" in n.attrs, false);
});

test("el: children may be a string, a node, an array or contain nulls", () => {
  assert.deepEqual(el("p", {}, "hi").children, [{ text: "hi" }]);
  const child = el("b");
  const n = el("p", {}, ["a", null, child, undefined]);
  assert.deepEqual(n.children, [{ text: "a" }, child]);
  assert.deepEqual(el("p").children, []);
});
