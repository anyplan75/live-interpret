const test = require("node:test");
const assert = require("node:assert/strict");
const { createClient } = require("../docs/js/identity");

test("church signup uses the REST API and does not touch Firebase Auth", async () => {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url, body: JSON.parse(opts.body) });
    if (String(url).includes("accounts:signUp")) {
      return {
        ok: true,
        text: async () => JSON.stringify({ localId: "church-uid", email: "church@example.com", idToken: "new-token" }),
      };
    }
    if (String(url).includes("accounts:signInWithPassword")) {
      return {
        ok: true,
        text: async () => JSON.stringify({ localId: "church-uid", idToken: "signed-token", email: "church@example.com" }),
      };
    }
    if (String(url).includes("accounts:update")) {
      return {
        ok: true,
        text: async () => JSON.stringify({ localId: "church-uid", email: "next@example.com", idToken: "updated-token" }),
      };
    }
    throw new Error(`unexpected ${url}`);
  };
  const client = createClient({ apiKey: "test-key", fetchImpl });
  const created = await client.signUp("church@example.com", "secret1");
  assert.equal(created.localId, "church-uid");
  assert.match(calls[0].url, /accounts:signUp/);
  assert.equal(calls[0].body.password, "secret1");
  assert.equal(calls[0].body.returnSecureToken, true);
  const signed = await client.signIn("church@example.com", "secret1");
  const updated = await client.updateAccount(signed.idToken, { email: "next@example.com", password: "secret2" });
  assert.equal(updated.email, "next@example.com");
  assert.equal(calls.at(-1).body.idToken, "signed-token");
  assert.equal(calls.at(-1).body.password, "secret2");
  assert.equal(global.firebase, undefined);
});
