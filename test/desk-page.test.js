const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

test("the web settings page starts a broadcast without picking a device", () => {
  const page = read("docs/desk/index.html");
  const client = read("docs/js/desk-client.js");
  assert.match(page, /<h1>통역 설정<\/h1>/);
  assert.match(page, /id="start"/);
  assert.match(page, /id="stop"/);
  assert.match(page, /id="langs"/);
  assert.match(page, /id="showName"/);
  assert.match(page, /id="operator"/);
  assert.match(page, /id="testPeriod"/);
  assert.match(page, /남은 충전금/);
  assert.match(page, /불러오는 중/);
  assert.match(page, /liDeskSession/);
  assert.match(page, /history\.replaceState/);
  assert.match(client, /room\/desired/);
  assert.match(client, /room\/status/);
  assert.match(client, /withRev/);
  assert.match(client, /sessionStorage/);
  assert.doesNotMatch(page, /id="device"|설교|교회/);
  assert.doesNotMatch(client, /console\.(log|info|debug)/);
  assert.doesNotMatch(client, /location\.hash/);
});
