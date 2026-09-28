const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { sessionDir, safeChurchName, sessionFolderName } = require("../broadcast/lib/paths");
const { createSessionWriter } = require("../broadcast/lib/files");

test("session files stay inside the chosen folder as text", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "live-interpret-"));
  const when = new Date(2026, 8, 28, 14, 5, 6);
  const writer = createSessionWriter(root, "../서귀포제일교회", when);
  writer.write("ko", "첫째 문장");
  writer.write("zh-CN", "中文");
  const folder = sessionFolderName(when);
  assert.equal(folder, "2026-09-28_14-05-06");
  assert.equal(path.basename(writer.dir), folder);
  assert.ok(writer.dir.startsWith(path.resolve(root) + path.sep));
  assert.equal(safeChurchName("../서귀포제일교회").includes("/"), false);
  const names = fs.readdirSync(writer.dir);
  assert.deepEqual(names.sort(), ["ko.txt", "zh-CN.txt"]);
  assert.equal(fs.readFileSync(path.join(writer.dir, "ko.txt"), "utf8"), "첫째 문장\n");
  assert.throws(() => sessionDir(root, "교회", "../2026-09-28_14-05-06"), /세션 폴더/);
  fs.rmSync(root, { recursive: true, force: true });
});
