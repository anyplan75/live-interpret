const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const catalog = require("../broadcast/lib/catalog");

test("language list matches the worship set", () => {
  assert.equal(catalog.languages.length, 17);
  assert.deepEqual(catalog.defaultSelectedTargets(), ["en", "zh-CN", "ja", "vi", "th", "id", "ne", "tl"]);
  assert.ok(catalog.langByCode["zh-TW"]);
  assert.ok(catalog.langByCode.si);
  assert.equal(catalog.firebase.rootPath, "live-interpret");
});

test("glossary keeps the worship correction pattern", () => {
  const text = catalog.defaultGlossary("서귀포제일교회");
  ["서귀포제일교회", "항존직", "이른비", "열방", "여짜오되", "수요 기도회"].forEach((term) => {
    assert.match(text, new RegExp(term));
  });
  const keywords = catalog.keywordsFromGlossary(text, "서귀포제일교회");
  assert.ok(keywords.includes("서귀포제일교회"));
  assert.ok(keywords.every((word) => !/[<>\r\n]/.test(word)));
});

test("one platform key and church activation", () => {
  const sample = `sk-${"a".repeat(12)}`;
  assert.equal(catalog.platformKeyRel, "platform/openaiKey");
  assert.equal(catalog.adminUidRel, "admin/uid");
  assert.equal(catalog.underRoot(catalog.platformKeyRel), "live-interpret/platform/openaiKey");
  assert.equal(catalog.underRoot(catalog.adminUidRel), "live-interpret/admin/uid");
  assert.equal(catalog.canClaimAdmin(null), true);
  assert.equal(catalog.canClaimAdmin(""), true);
  assert.equal(catalog.canClaimAdmin("uid-1"), false);
  assert.equal(catalog.isCurrentAdmin("uid-1", "uid-1"), true);
  assert.equal(catalog.isCurrentAdmin("uid-1", "uid-2"), false);
  assert.equal(catalog.validAdminEmail("a@b.co"), true);
  assert.equal(catalog.validAdminEmail("not-an-email"), false);
  assert.equal(catalog.validAdminPassword("12345"), false);
  assert.equal(catalog.validAdminPassword("123456"), true);
  assert.match(catalog.authErrorMessage({ code: "auth/unauthorized-domain" }), /anyplan75\.github\.io/);
  assert.equal(catalog.firebase.projectId, "live-interpret-db65e");
  assert.equal(catalog.firebase.authDomain, "live-interpret-db65e.firebaseapp.com");
  assert.match(catalog.firebase.apiKey, /^AIza/);
  assert.equal(catalog.isPlatformKey(sample), true);
  assert.equal(catalog.isPlatformKey("short"), false);
  assert.equal(catalog.redactSecrets(`err ${sample} tail`).includes(sample), false);
  assert.equal(catalog.churchIsActive({ name: "알파" }), true);
  assert.equal(catalog.churchIsActive(null), true);
  assert.equal(catalog.churchIsActive(false), false);
  assert.equal(catalog.churchIsActive({ active: false }), false);
  const { activeChurchesFromIndex } = require("../broadcast/lib/firebase");
  const visible = activeChurchesFromIndex({
    "alpha-ab": { name: "알파", active: true },
    "beta-cd": { name: "베타", active: false },
    "gamma-ef": { name: "감마" },
  });
  assert.deepEqual(visible.map((row) => row.name), ["감마", "알파"]);
});

test("admin holds the key and broadcast does not ask for one", () => {
  const root = path.join(__dirname, "..");
  const admin = fs.readFileSync(path.join(root, "docs/admin.html"), "utf8");
  const adminJs = fs.readFileSync(path.join(root, "docs/js/admin.js"), "utf8");
  const broadcast = fs.readFileSync(path.join(root, "broadcast/renderer/index.html"), "utf8");
  const renderer = fs.readFileSync(path.join(root, "broadcast/renderer/renderer.js"), "utf8");
  const listen = fs.readFileSync(path.join(root, "docs/listen.html"), "utf8");
  const overlay = fs.readFileSync(path.join(root, "docs/overlay.html"), "utf8");
  const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");
  const authJs = fs.readFileSync(path.join(root, "docs/js/auth.js"), "utf8");
  const rules = JSON.parse(fs.readFileSync(path.join(root, "firebase/live-interpret.rules.json"), "utf8"));
  assert.match(admin, /id="apiKey"/);
  assert.match(admin, /id="toggleActive"/);
  assert.match(admin, /id="saveKey"/);
  assert.match(admin, /id="gate"/);
  assert.match(admin, /id="adminApp" hidden/);
  assert.match(admin, /firebase-auth-compat/);
  assert.match(adminJs, /platformKeyRel/);
  assert.match(adminJs, /toggleActive/);
  assert.match(adminJs, /signUp/);
  assert.match(authJs, /canClaimAdmin/);
  assert.match(authJs, /createUserWithEmailAndPassword/);
  assert.doesNotMatch(broadcast, /apiKey|API 키|sk-/);
  assert.match(broadcast, /id="adminEmail"/);
  assert.match(broadcast, /id="adminPassword"/);
  assert.match(broadcast, /한 번만 로그인/);
  assert.doesNotMatch(renderer, /apiKey/);
  assert.match(renderer, /signIn/);
  assert.doesNotMatch(listen, /type="password"|gateSubmit|signUp/);
  assert.doesNotMatch(overlay, /type="password"|gateSubmit|signUp/);
  assert.match(listen, /churchIsActive/);
  assert.match(overlay, /churchIsActive/);
  assert.match(listen, /startPrompter/);
  assert.match(overlay, /startOverlay/);
  assert.deepEqual(Object.keys(rules), ["live-interpret"]);
  assert.match(rules["live-interpret"].platform.openaiKey[".read"], /auth\.uid/);
  assert.match(rules["live-interpret"].platform.openaiKey[".write"], /auth\.uid/);
  assert.doesNotMatch(JSON.stringify(rules), /cheil|jifc/);
  const keyRule = rules["live-interpret"].platform.openaiKey[".read"];
  assert.equal(keyRule === true || keyRule === "true", false);
  assert.equal(/sk-[A-Za-z0-9_-]{8,}/.test(readme), false);
  assert.equal(/sk-[A-Za-z0-9_-]{8,}/.test(admin), false);
  assert.equal(/sk-[A-Za-z0-9_-]{8,}/.test(broadcast), false);
});

test("firebase paths stay under live-interpret", () => {
  assert.equal(catalog.underRoot("churches/abc/live/subtitles"), "live-interpret/churches/abc/live/subtitles");
  assert.throws(() => catalog.underRoot("cheil/subtitles"), /cheil/);
  assert.throws(() => catalog.underRoot(`/${"jifc"}/subtitles`), /jifc/);
  assert.throws(() => catalog.assertFirebasePath("cheil"), /live-interpret/);
  assert.throws(() => catalog.underRoot("../cheil"), /잘못된/);
  assert.equal(catalog.isChurchId("cheil"), false);
  assert.equal(catalog.isChurchId("jifc"), false);
  assert.equal(catalog.isChurchId(catalog.makeChurchId("새 교회")), true);
});

test("source does not target cheil or jifc firebase paths", () => {
  const root = path.join(__dirname, "..");
  const skip = new Set(["node_modules", ".git", "dist", "out"]);
  const bad = [];
  function walk(dir) {
    for (const name of fs.readdirSync(dir)) {
      if (skip.has(name)) continue;
      const full = path.join(dir, name);
      const stat = fs.statSync(full);
      if (stat.isDirectory()) walk(full);
      else if (/\.(js|html|css|md|json)$/.test(name)) {
        const text = fs.readFileSync(full, "utf8");
        if (/["'`]\/(?:cheil|jifc)(?:\/|["'`])/.test(text) || /rootPath\s*[:=]\s*["'](?:cheil|jifc)["']/.test(text)) {
          bad.push(path.relative(root, full));
        }
      }
    }
  }
  walk(root);
  assert.deepEqual(bad, []);
});
