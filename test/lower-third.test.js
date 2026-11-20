const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

test("YoloBox lower third page stays transparent and query-driven", () => {
  const page = read("docs/overlay/index.html");
  const css = read("docs/css/lower-third.css");
  const viewer = read("docs/js/viewer.js");
  const guide = read("전체구조안내서.md");

  assert.match(page, /lower-third\.css/);
  assert.match(page, /queryLowerThird|startLowerThird/);
  assert.match(css, /background:\s*transparent\s*!important/);
  assert.match(css, /#caption\.is-fading/);
  assert.match(css, /\.pos-bottom/);
  assert.match(css, /\.size-large/);
  assert.match(viewer, /function queryLowerThird/);
  assert.match(viewer, /function startLowerThird/);
  assert.match(viewer, /is-fading/);
  assert.match(guide, /YoloBox/);
  assert.match(guide, /\/overlay\//);
  assert.match(guide, /OBS `overlay\.html`과 역할이 다르다|OBS는 설정 웹/);
});

test("queryLowerThird reads lang pos size margin", async () => {
  const catalog = require("../docs/js/catalog.js");
  const sandbox = {
    window: {},
    location: { search: "?church=demo-ab&lang=en&pos=top&size=large&margin=8" },
    LI: { catalog },
    URLSearchParams,
    document: { head: { appendChild() {} }, querySelector() { return null; }, documentElement: {} },
    requestAnimationFrame: (fn) => fn(),
  };
  sandbox.window.LI = sandbox.LI;
  vm.createContext(sandbox);
  vm.runInContext(read("docs/js/viewer.js"), sandbox);
  const layout = sandbox.LI.viewer.queryLowerThird();
  assert.equal(layout.lang, "en");
  assert.equal(layout.pos, "top");
  assert.equal(layout.size, "large");
  assert.equal(layout.margin, 8);
});

test("OBS overlay.html path stays separate from /overlay/", () => {
  const obs = read("docs/overlay.html");
  assert.match(obs, /overlay\.css/);
  assert.match(obs, /startOverlay/);
  assert.doesNotMatch(obs, /startLowerThird/);
  assert.ok(fs.existsSync(path.join(root, "docs/overlay/index.html")));
});
