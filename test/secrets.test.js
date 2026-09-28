const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const secrets = require("../broadcast/lib/secrets");
const { withAuth, setIdToken } = require("../broadcast/lib/firebase");

test("openai key file is not world-readable and session omits the key", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "live-interpret-secret-"));
  const key = `sk-${"b".repeat(20)}`;
  secrets.writeKey(dir, key);
  const keyStat = fs.statSync(path.join(dir, secrets.KEY_NAME));
  assert.equal(keyStat.mode & 0o077, 0);
  assert.equal(secrets.readKey(dir), key);
  secrets.writeSession(dir, { refreshToken: "refresh-token", email: "a@b.co", localId: "uid" });
  const sessionStat = fs.statSync(path.join(dir, secrets.SESSION_NAME));
  assert.equal(sessionStat.mode & 0o077, 0);
  const raw = fs.readFileSync(path.join(dir, secrets.SESSION_NAME), "utf8");
  assert.equal(raw.includes(key), false);
  assert.equal(raw.includes("password"), false);
  assert.equal(secrets.readSession(dir).email, "a@b.co");
  secrets.clearSession(dir);
  assert.equal(secrets.readSession(dir), null);
});

test("firebase requests attach the admin token only when signed in", () => {
  setIdToken("");
  assert.equal(withAuth("https://example.test/live.json"), "https://example.test/live.json");
  setIdToken("id-token");
  assert.equal(withAuth("https://example.test/live.json"), "https://example.test/live.json?auth=id-token");
  assert.equal(
    withAuth("https://example.test/live.json?shallow=true"),
    "https://example.test/live.json?shallow=true&auth=id-token"
  );
  setIdToken("");
});
