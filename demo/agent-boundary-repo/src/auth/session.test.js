import test from "node:test";
import assert from "node:assert/strict";
import { normalizeSessionToken } from "./session.js";

test("normalizes a non-empty session token", () => {
  assert.equal(normalizeSessionToken("  demo-token  "), "demo-token");
});

test("rejects a blank session token", () => {
  assert.equal(normalizeSessionToken("   "), null);
});
