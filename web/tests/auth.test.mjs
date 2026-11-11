import assert from "node:assert/strict";
import test from "node:test";

import {
  issueSessionToken,
  verifyAccessPassword,
  verifySessionToken,
} from "../src/lib/auth.ts";

const secret = "unit-test-secret-that-is-at-least-32-characters-long";
const fixedNow = Date.UTC(2026, 10, 11, 10, 0, 0);

test("session token verifies before expiry", async () => {
  const token = await issueSessionToken(secret, fixedNow);
  assert.equal(await verifySessionToken(token, secret, fixedNow + 1000), true);
});

test("expired session token is rejected", async () => {
  const token = await issueSessionToken(secret, fixedNow);
  assert.equal(await verifySessionToken(token, secret, fixedNow + 8 * 60 * 60 * 1000), false);
});

test("tampered and malformed session tokens are rejected", async () => {
  const token = await issueSessionToken(secret, fixedNow);
  assert.equal(await verifySessionToken(`${token.slice(0, -1)}0`, secret, fixedNow), false);
  assert.equal(await verifySessionToken("not-a-session", secret, fixedNow), false);
});

test("session token is bound to its signing secret", async () => {
  const token = await issueSessionToken(secret, fixedNow);
  assert.equal(await verifySessionToken(token, `${secret}-wrong`, fixedNow), false);
});

test("password comparison accepts only the exact configured password", async () => {
  assert.equal(await verifyAccessPassword("correct horse battery staple", "correct horse battery staple"), true);
  assert.equal(await verifyAccessPassword("incorrect password", "correct horse battery staple"), false);
});
