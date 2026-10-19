const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { firebase, underRoot } = require("../broadcast/lib/catalog");
const mirror = require("../scripts/export-firebase-mirror");

const repoRoot = path.join(__dirname, "..");

function response(status, body, raw = false) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => (raw ? String(body) : JSON.stringify(body)),
  };
}

test("mirror paths are the app records and skip secrets and live captions", () => {
  assert.deepEqual(mirror.MIRROR_RELS, [
    "admin/uid",
    "accounts",
    "churchIndex",
    "deposits",
    "churches",
  ]);
  assert.deepEqual(mirror.OMITTED, [
    "platform/openaiKey",
    "phoneLinks",
    "churches/*/live/subtitles",
    "churches/*/live/micToken",
  ]);
  for (const rel of mirror.MIRROR_RELS) {
    assert.equal(underRoot(rel), `live-interpret/${rel}`);
  }
  assert.equal(mirror.ROOT, "live-interpret");
  assert.equal(
    mirror.DEFAULT_DATABASE_URL,
    "https://live-interpret-db65e-default-rtdb.asia-southeast1.firebasedatabase.app"
  );
});

test("replica keeps sermons and drops keys, passwords, and live subtitles", () => {
  const doc = mirror.replicaDocument({
    databaseURL: mirror.DEFAULT_DATABASE_URL,
    exportedAt: new Date("2026-10-16T15:30:00.000Z"),
    records: {
      "admin/uid": "admin-1",
      accounts: { uid1: { churchId: "seogwipo" } },
      churchIndex: { seogwipo: { name: "서귀포제일교회", active: true } },
      deposits: null,
      churches: {
        seogwipo: {
          name: "서귀포제일교회",
          glossary: "항존직",
          account: { email: "a@b.co", password: "drop-me" },
          openaiKey: "sk-shouldnotappearxxxx",
          preachers: { kim: { name: "김", corrections: "열반 → 열방" } },
          sessions: { "2026-10-16-0900": { texts: { ko: "본문" } } },
          billing: { balance: 15000 },
          live: {
            settings: { fontScale: 1 },
            usage: { audioSeconds: 3 },
            subtitles: { ko: "지금 자막" },
            micToken: "a".repeat(32),
          },
        },
      },
      phoneLinks: { abc: { offer: "sdp" } },
      platform: { openaiKey: "sk-platformkeyxxxxxxxx" },
    },
  });
  assert.equal(doc.calendarDate, "2026-10-17");
  assert.equal(doc.timezone, "Asia/Seoul");
  assert.equal(doc.records["admin/uid"], "admin-1");
  assert.equal(doc.records.churches.seogwipo.sessions["2026-10-16-0900"].texts.ko, "본문");
  assert.equal(doc.records.churches.seogwipo.preachers.kim.corrections, "열반 → 열방");
  assert.equal(doc.records.churches.seogwipo.live.settings.fontScale, 1);
  assert.equal(doc.records.churches.seogwipo.billing.balance, 15000);
  assert.equal(doc.records.churches.seogwipo.live.subtitles, undefined);
  assert.equal(doc.records.churches.seogwipo.live.micToken, undefined);
  assert.equal(doc.records.churches.seogwipo.account.password, undefined);
  assert.equal(doc.records.churches.seogwipo.account.email, "a@b.co");
  assert.equal(doc.records.churches.seogwipo.openaiKey, undefined);
  assert.equal(doc.records.phoneLinks, undefined);
  assert.equal(doc.records.platform, undefined);
  assert.equal(JSON.stringify(doc).includes("sk-"), false);
  assert.equal(JSON.stringify(doc).includes("drop-me"), false);
  if (firebase.apiKey) assert.equal(JSON.stringify(doc).includes(firebase.apiKey), false);
});

test("seoul date changes at midnight", () => {
  assert.equal(mirror.seoulDate(new Date("2026-10-16T14:59:00.000Z")), "2026-10-16");
  assert.equal(mirror.seoulDate(new Date("2026-10-16T15:00:00.000Z")), "2026-10-17");
});

test("archive folder stays outside this repo", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "mirror-home-"));
  const dir = mirror.archiveDirFromEnv({}, home, repoRoot);
  assert.equal(dir, path.join(home, "Documents", "live-interpret-private-archive"));
  assert.throws(() => mirror.archiveDirFromEnv({ LIVE_INTERPRET_ARCHIVE_DIR: repoRoot }, home, repoRoot), /저장소 밖/);
  assert.throws(
    () => mirror.databaseUrlFromEnv({
      LIVE_INTERPRET_FIREBASE_DATABASE_URL: "https://user:secret@example.test/db?auth=token",
    }),
    /인증 정보/
  );
});

test("daily export writes the replica and never the credential", async () => {
  const archive = fs.mkdtempSync(path.join(os.tmpdir(), "mirror-archive-"));
  const refresh = "refresh-value-not-for-disk";
  const apiKey = "web-api-key-not-for-disk";
  const idToken = "id-token-not-for-disk";
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ href: String(url), method: options.method, body: options.body ? String(options.body) : "" });
    const href = String(url);
    if (href.includes("securetoken.googleapis.com")) {
      assert.equal(href.includes(apiKey), true);
      assert.equal(String(options.body).includes(refresh), true);
      return response(200, { id_token: idToken, refresh_token: refresh });
    }
    assert.equal(new URL(href).searchParams.get("auth"), idToken);
    const rel = decodeURIComponent(new URL(href).pathname.replace(/^\/live-interpret\//, "").replace(/\.json$/, ""));
    const payloads = {
      "admin/uid": "admin-1",
      accounts: { uid1: { churchId: "seogwipo" } },
      churchIndex: { seogwipo: { name: "서귀포제일교회" } },
      deposits: { d1: { amountKrw: 15000 } },
      churches: {
        seogwipo: {
          name: "서귀포제일교회",
          live: { subtitles: { ko: "지우기" }, settings: { fontScale: 2 } },
        },
      },
    };
    assert.equal(Object.prototype.hasOwnProperty.call(payloads, rel), true);
    return response(200, payloads[rel]);
  };
  const result = await mirror.exportMirror({
    env: {
      LIVE_INTERPRET_FIREBASE_REFRESH_TOKEN: refresh,
      FIREBASE_API_KEY: apiKey,
      LIVE_INTERPRET_ARCHIVE_DIR: archive,
    },
    fetchImpl,
    now: new Date("2026-10-16T18:00:00.000Z"),
    repoRoot,
  });
  const fetched = calls.filter((call) => call.href.includes("firebasedatabase.app")).map((call) => new URL(call.href).pathname);
  assert.deepEqual(fetched, mirror.MIRROR_RELS.map((rel) => `/live-interpret/${rel}.json`));
  assert.equal(calls.some((call) => call.href.includes("openaiKey") || call.href.includes("phoneLinks")), false);
  assert.equal(result.doc.calendarDate, "2026-10-17");
  assert.equal(result.doc.records.churches.seogwipo.live.subtitles, undefined);
  assert.equal(result.doc.records.churches.seogwipo.live.settings.fontScale, 2);
  const dated = fs.readFileSync(result.files.dated, "utf8");
  const latest = fs.readFileSync(result.files.latest, "utf8");
  assert.equal(dated, latest);
  assert.equal(dated.includes(refresh), false);
  assert.equal(dated.includes(apiKey), false);
  assert.equal(dated.includes(idToken), false);
  if (firebase.apiKey) assert.equal(dated.includes(firebase.apiKey), false);
  assert.equal(fs.statSync(result.files.dated).mode & 0o077, 0);
});

test("refresh errors do not echo the token", async () => {
  const refresh = "refresh-echo-should-hide";
  const apiKey = "api-echo-should-hide";
  await assert.rejects(
    () => mirror.exportMirror({
      env: {
        LIVE_INTERPRET_FIREBASE_REFRESH_TOKEN: refresh,
        FIREBASE_API_KEY: apiKey,
        LIVE_INTERPRET_ARCHIVE_DIR: fs.mkdtempSync(path.join(os.tmpdir(), "mirror-fail-")),
      },
      fetchImpl: async () => response(400, `invalid ${refresh} ${apiKey}`, true),
      repoRoot,
    }),
    (err) => {
      assert.equal(err.message.includes(refresh), false);
      assert.equal(err.message.includes(apiKey), false);
      assert.match(err.message, /\[redacted\]/);
      return true;
    }
  );
});

test("committed mirror files do not contain credentials", () => {
  const files = [
    "scripts/export-firebase-mirror.js",
    "n8n/firebase-daily-mirror.json",
    "docs/firebase-n8n-daily-mirror.md",
  ];
  for (const rel of files) {
    const text = fs.readFileSync(path.join(repoRoot, rel), "utf8");
    if (firebase.apiKey) assert.equal(text.includes(firebase.apiKey), false, rel);
    assert.equal(/sk-[A-Za-z0-9_-]{8,}/.test(text), false, rel);
    assert.equal(text.includes("ghp_"), false, rel);
    assert.equal(text.includes("github_pat_"), false, rel);
  }
  const workflow = JSON.parse(fs.readFileSync(path.join(repoRoot, "n8n/firebase-daily-mirror.json"), "utf8"));
  assert.equal(workflow.active, false);
  assert.equal(workflow.settings.timezone, "Asia/Seoul");
  const urls = [];
  const walk = (value) => {
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    if (!value || typeof value !== "object") return;
    if (typeof value.url === "string") urls.push(value.url);
    if (value.httpCustomAuth) {
      assert.equal(value.httpCustomAuth.id, "");
      assert.equal(value.httpCustomAuth.name, "");
    }
    if (value.name === "key" || value.name === "refresh_token") assert.equal(value.value, "");
    Object.values(value).forEach(walk);
  };
  walk(workflow);
  for (const rel of mirror.MIRROR_RELS) {
    assert.equal(urls.some((url) => url.endsWith(`/live-interpret/${rel}.json`)), true, rel);
  }
  assert.equal(urls.some((url) => url.includes("openaiKey") || url.includes("phoneLinks")), false);
  assert.equal(JSON.stringify(workflow).includes("AIza"), false);
});
