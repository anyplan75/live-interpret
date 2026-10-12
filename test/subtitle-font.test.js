const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const catalog = require("../docs/js/catalog");
const firebase = require("../broadcast/lib/firebase");
const { Engine } = require("../broadcast/lib/engine");

const root = path.join(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

const ids = [
  "pretendard",
  "noto-sans-kr",
  "noto-serif-kr",
  "ibm-plex-sans-kr",
  "noto-sans-tc",
  "noto-sans-sc",
  "noto-sans-jp",
  "inter",
  "roboto",
  "nanum-gothic",
];

test("subtitle fonts are exactly the ten choices", () => {
  assert.deepEqual(catalog.subtitleFonts.map((face) => face.id), ids);
  assert.deepEqual(catalog.subtitleFonts.map((face) => face.label), [
    "Pretendard",
    "본고딕",
    "본명조",
    "IBM Plex Sans KR",
    "Noto Sans TC",
    "Noto Sans SC",
    "Noto Sans JP",
    "Inter",
    "Roboto",
    "나눔고딕",
  ]);
  catalog.subtitleFonts.forEach((face) => {
    assert.equal((face.href.match(/family=/g) || []).length <= 1, true);
    assert.match(face.family, /sans-serif|serif/);
  });
});

test("unsaved languages get the default face", () => {
  assert.equal(catalog.subtitleFontId(undefined, "ko"), "pretendard");
  assert.equal(catalog.subtitleFontId(undefined, "en"), "inter");
  assert.equal(catalog.subtitleFontId(undefined, "zh-TW"), "noto-sans-tc");
  assert.equal(catalog.subtitleFontId(undefined, "zh-Hant"), "noto-sans-tc");
  assert.equal(catalog.subtitleFontId(undefined, "zh-CN"), "noto-sans-sc");
  assert.equal(catalog.subtitleFontId(undefined, "zh-Hans"), "noto-sans-sc");
  assert.equal(catalog.subtitleFontId(undefined, "ja"), "noto-sans-jp");
  assert.equal(catalog.subtitleFontId(undefined, "vi"), "inter");
  assert.equal(catalog.subtitleFontId("not-a-font", "ko"), "pretendard");
  assert.equal(catalog.subtitleFontId("roboto", "ko"), "roboto");

  const fresh = catalog.defaultLiveSettings();
  assert.equal(fresh.ko.font, "pretendard");
  assert.equal(fresh.en.font, "inter");
  assert.equal(fresh["zh-TW"].font, "noto-sans-tc");
  assert.equal(fresh["zh-CN"].font, "noto-sans-sc");
  assert.equal(fresh.ja.font, "noto-sans-jp");
  assert.equal(fresh.vi.font, "inter");

  const cleaned = catalog.sanitizeStyle({ fonts: { en: { font: "nanum-gothic" }, ko: { font: "nope" } } });
  assert.equal(cleaned.fonts.en.font, "nanum-gothic");
  assert.equal(cleaned.fonts.ko.font, "pretendard");
  const stored = catalog.applyStyleToSettings({ en: { show: true, font: "inter" } }, {
    fonts: { en: { font: "roboto", fontSize: 30, letterSpacing: 1 } },
  });
  assert.equal(stored.en.show, true);
  assert.equal(stored.en.font, "roboto");
  assert.equal(catalog.styleFromSettings(stored).fonts.en.font, "roboto");
});

test("overlay and listener load only the selected face", () => {
  const overlay = read("docs/overlay.html");
  const listen = read("docs/listen.html");
  const viewer = read("docs/js/viewer.js");
  assert.doesNotMatch(overlay, /fonts\.googleapis\.com|pretendard\.css/);
  assert.doesNotMatch(listen, /fonts\.googleapis\.com|pretendard\.css/);
  assert.match(listen, /useSubtitleFont/);
  assert.match(viewer, /link\[data-subtitle-font\]/);
  assert.match(viewer, /if \(link\) link\.remove\(\)/);
  assert.match(viewer, /subtitle\.style\.fontFamily = useSubtitleFont/);
});

test("broadcast language rows offer the font list", () => {
  const renderer = read("broadcast/renderer/renderer.js");
  const html = read("broadcast/renderer/index.html");
  const main = read("broadcast/main.js");
  assert.match(renderer, /글꼴/);
  assert.match(renderer, /data-font/);
  assert.match(renderer, /styleOutputLanguages/);
  assert.match(html, /id="subtitleStyleCard"/);
  assert.match(html, /id="pickFolder"[\s\S]*id="subtitleStyleCard"/);
  assert.match(renderer, /subtitleFonts/);
  assert.match(main, /subtitleFonts/);
  assert.match(main, /defaultFont/);
});

test("live settings accept a font without a rules change", () => {
  const rules = JSON.parse(read("firebase/live-interpret.rules.json"));
  const settings = rules["live-interpret"].churches.$churchId.live.settings;
  assert.equal(settings[".write"] != null, true);
  assert.equal(Object.prototype.hasOwnProperty.call(settings, ".validate"), false);
});

test("saving targets keeps a language font", async () => {
  const original = { get: firebase.get, set: firebase.set };
  const sets = [];
  firebase.get = async () => ({
    en: { font: "roboto", fontSize: 30, letterSpacing: 2, show: true },
  });
  firebase.set = async (rel, value) => { sets.push([rel, value]); };
  try {
    const engine = new Engine(() => {});
    await engine.syncSettings("grace", ["en", "ja"]);
    assert.equal(sets.length, 1);
    assert.match(sets[0][0], /live\/settings$/);
    assert.equal(sets[0][1].en.font, "roboto");
    assert.equal(sets[0][1].ko.font, "pretendard");
    assert.equal(sets[0][1].ja.font, "noto-sans-jp");
    assert.equal(sets[0][1].vi.font, "inter");
  } finally {
    firebase.get = original.get;
    firebase.set = original.set;
  }
});
