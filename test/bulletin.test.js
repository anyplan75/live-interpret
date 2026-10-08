const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const bulletin = require("../broadcast/lib/bulletin");

test("bulletin image is stored on disk and extraction is normalized", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "live-interpret-bulletin-"));
  const source = path.join(root, "source.jpg");
  fs.writeFileSync(source, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  const staged = bulletin.stageBulletin(path.join(root, "pending"), source);
  assert.equal(fs.existsSync(staged.absolutePath), true);
  assert.equal(staged.imageRef, "bulletin.jpg");
  const session = path.join(root, "session");
  const stored = bulletin.persistBulletinImage(session, staged.absolutePath);
  assert.equal(fs.existsSync(path.join(session, "bulletin.jpg")), true);
  assert.notEqual(stored.absolutePath, staged.absolutePath);

  const calls = [];
  const fetchImpl = async (_url, opts) => {
    const body = JSON.parse(opts.body);
    calls.push(body);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{
          message: {
            content: JSON.stringify({
              hymnNumbers: ["123", "456"],
              songTitles: ["만복의 근원 하나님"],
              scripture: "요한복음 3:16",
              sermonTitle: "하나님의 사랑",
              preacherName: "김목사",
              extractedText: "찬송 123",
            }),
          },
        }],
      }),
    };
  };
  const extracted = await bulletin.analyzeBulletinImage({
    apiKey: "sk-test",
    model: "gpt-4o-mini",
    imagePath: stored.absolutePath,
    fetchImpl,
  });
  assert.deepEqual(extracted.hymnNumbers, ["123", "456"]);
  assert.equal(extracted.songTitles[0], "만복의 근원 하나님");
  assert.equal(extracted.preacherName, "김목사");
  assert.match(calls[0].messages[0].content[1].image_url.url, /^data:image\/jpeg;base64,/);
  const record = bulletin.writeExtractionFile(session, stored.imageRef, extracted);
  const reread = bulletin.readStagedExtraction(session);
  assert.equal(reread.sermonTitle, "하나님의 사랑");
  assert.equal(record.imageRef, "bulletin.jpg");
  assert.equal(fs.existsSync(path.join(session, "bulletin.json")), true);
});
