const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const css = fs.readFileSync(path.join(root, "docs/css/overlay.css"), "utf8");
const viewer = fs.readFileSync(path.join(root, "docs/js/viewer.js"), "utf8");
const broadcast = fs.readFileSync(path.join(root, "broadcast/renderer/index.html"), "utf8");

function block(source, selector) {
  const start = source.indexOf(selector);
  assert.ok(start >= 0, selector);
  const open = source.indexOf("{", start);
  const close = source.indexOf("}", open);
  return source.slice(open + 1, close);
}

function stops(source) {
  return [...source.matchAll(/rgba\(var\(--shade-r\), var\(--shade-g\), var\(--shade-b\), (?:var\(--shade-a\)|calc\(var\(--shade-a\) \* [0-9.]+\)|0)\) ([0-9.]+)%/g)].map((match) => ({
    at: Number(match[1]),
    raw: match[0],
  }));
}

test("overlay scrim is one edge band per layout", () => {
  const bottom = block(css, ".layout-bottom::before");
  const top = block(css, ".layout-top::before");
  const left = block(css, ".layout-left::before");
  const right = block(css, ".layout-right::before");
  assert.match(bottom, /height:\s*calc\(100vh\s*\/\s*6\)/);
  assert.match(top, /height:\s*calc\(100vh\s*\/\s*6\)/);
  assert.match(left, /width:\s*calc\(100vw\s*\/\s*2\)/);
  assert.match(right, /width:\s*calc\(100vw\s*\/\s*2\)/);
  assert.match(bottom, /--shade-dir:\s*to top/);
  assert.match(top, /--shade-dir:\s*to bottom/);
  assert.match(left, /--shade-dir:\s*to right/);
  assert.match(right, /--shade-dir:\s*to left/);
  assert.match(css, /--shade-a:\s*0\.7/);
  assert.doesNotMatch(css, /background:\s*rgba\(0,\s*0,\s*0,\s*0\.7\)/);
});

test("gradient tail reaches zero without a hard stop", () => {
  const band = stops(css);
  assert.ok(band.length >= 12);
  const positions = band.map((stop) => stop.at);
  assert.deepEqual(positions, [...positions].sort((a, b) => a - b));
  assert.equal(positions[0], 0);
  assert.equal(positions[positions.length - 1], 100);
  const factors = [...css.matchAll(/calc\(var\(--shade-a\)\s*\*\s*([0-9.]+)\)/g)].map((match) => Number(match[1]));
  assert.ok(factors.length >= 10);
  for (let i = 1; i < factors.length; i += 1) assert.ok(factors[i] <= factors[i - 1]);
  assert.ok(factors[factors.length - 1] < 0.001);
  assert.ok(factors[factors.length - 3] < 0.02);
  assert.match(css, /rgba\(var\(--shade-r\), var\(--shade-g\), var\(--shade-b\), 0\) 100%/);
});

test("opacity setting is the darkest alpha and the slider stays", () => {
  assert.match(viewer, /--shade-a/);
  assert.match(viewer, /bgOpacity/);
  assert.doesNotMatch(viewer, /subtitle\.style\.backgroundColor\s*=\s*hexToRgba/);
  assert.match(broadcast, /id="opacity"/);
  assert.match(broadcast, /투명도/);
});

test("subtitle stays on the dark side of the band", () => {
  assert.match(css, /\.layout-bottom #subtitle,\s*\.layout-top #subtitle\s*\{[^}]*max-height:\s*calc\(100vh\s*\/\s*6 \* 0\.62 - 0\.9vh\)/);
  assert.match(css, /\.layout-left #subtitle,\s*\.layout-right #subtitle\s*\{[^}]*max-width:\s*calc\(100vw\s*\/\s*2 \* 0\.5 - 1\.6vw\)/);
});
