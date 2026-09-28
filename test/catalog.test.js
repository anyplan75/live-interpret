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
