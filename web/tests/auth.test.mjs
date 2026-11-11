import assert from "node:assert/strict";
import test from "node:test";

import {
  issueSessionToken,
  verifyAccessPassword,
  verifySessionToken,
} from "../src/lib/auth.ts";

const secret = "unit-test-secret-that-is-at-least-32-characters-long";
process.env.CLIPPER_AUTH_SECRET = secret;
process.env.CLIPPER_ACCESS_PASSWORD = "correct horse battery staple";
const fixedNow = Date.UTC(2026, 10, 11, 10, 0, 0);

test("session token verifies before expiry", () => {
  const token = issueSessionToken(fixedNow);
  assert.equal(verifySessionToken(token, fixedNow + 1000), true);
});

test("expired session token is rejected", () => {
  const token = issueSessionToken(fixedNow);
  assert.equal(verifySessionToken(token, fixedNow + 8 * 60 * 60 * 1000), false);
});

test("tampered and malformed session tokens are rejected", () => {
  const token = issueSessionToken(fixedNow);
  assert.equal(verifySessionToken(`${token.slice(0, -1)}0`, fixedNow), false);
  assert.equal(verifySessionToken("not-a-session", fixedNow), false);
});

test("session token is bound to its signing secret", () => {
  const token = issueSessionToken(fixedNow);
  const original = process.env.CLIPPER_AUTH_SECRET;
  process.env.CLIPPER_AUTH_SECRET = `${secret}-different`;
  assert.equal(verifySessionToken(token, fixedNow), false);
  process.env.CLIPPER_AUTH_SECRET = original;
});

test("password comparison requires exact configured password", () => {
  const original = process.env.CLIPPER_ACCESS_PASSWORD;
  process.env.CLIPPER_ACCESS_PASSWORD = "correct horse battery staple";
  assert.equal(verifyAccessPassword("correct horse battery staple"), true);
  assert.equal(verifyAccessPassword("incorrect password"), false);
  process.env.CLIPPER_ACCESS_PASSWORD = original;
});
