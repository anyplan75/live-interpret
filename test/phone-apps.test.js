const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const broadcastCost = require("../broadcast/lib/cost");
const webCost = require("../docs/js/cost");
const org = require("../docs/js/org-services");
const speech = require("../docs/js/speech-turn");

const root = path.join(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

test("lecture and face use the existing hourly price", () => {
  assert.equal(broadcastCost.HOUR_BASE_KRW, 15000);
  assert.equal(broadcastCost.EXTRA_LANG_HOUR_KRW, 5000);
  assert.equal(webCost.HOUR_BASE_KRW, broadcastCost.HOUR_BASE_KRW);
  assert.equal(webCost.EXTRA_LANG_HOUR_KRW, broadcastCost.EXTRA_LANG_HOUR_KRW);
  const lecture = org.rateFor("lecture", ["ko", "en"]);
  const face = org.rateFor("face", ["ko", "en"]);
  const faceChinese = org.rateFor("face", ["ko", "zh-CN"]);
  assert.equal(lecture.hourKrw, 15000);
  assert.equal(lecture.baseKrw, broadcastCost.HOUR_BASE_KRW);
  assert.equal(face.hourKrw, 15000);
  assert.equal(faceChinese.hourKrw, 20000);
  assert.equal(faceChinese.extraLangKrw, 5000);
  assert.match(org.adminRateText(), /15,000원/);
  assert.match(org.adminRateText(), /5,000원/);
  assert.match(org.adminRateText(), /따로 등록/);
  assert.doesNotMatch(JSON.stringify(org.newOrgWrites({
    id: "grace-1",
    name: "은혜",
    kind: "company",
    email: "a@b.co",
    uid: "uid123456",
    lecture: true,
    face: false,
    model: "gpt-4o-mini",
    settings: {},
  })), /"rate"/);
});

test("an unregistered account cannot start a paid session", () => {
  const missing = org.canStartPaid(null, "lecture");
  assert.equal(missing.ok, false);
  const orgRow = org.orgSnapshot({
    id: "grace-1",
    name: "은혜",
    active: true,
    orgKind: "company",
    services: { lecture: { registered: true, registeredAt: 10 } },
  });
  assert.equal(orgRow.kind, "company");
  assert.equal(org.canStartPaid(orgRow, "lecture").ok, true);
  assert.equal(org.canStartPaid(orgRow, "face").ok, false);
  assert.equal(org.canStartPaid({ ...orgRow, active: false }, "lecture").ok, false);
  const guest = org.guestJoin("ab".repeat(16));
  assert.equal(guest.ok, true);
  assert.equal(guest.paid, false);
  assert.equal(org.guestJoin("nope").ok, false);
});

test("face billing uses the prepaid hour and half block from cost.js", () => {
  const charge = org.chargePatch({
    balance: 20000,
    languages: ["ko", "en"],
    now: 1000,
    who: "uid123456",
    churchId: "grace-1",
    note: "대면 통역",
  });
  assert.equal(charge.ok, true);
  assert.equal(charge.patch.balance, 5000);
  assert.equal(charge.patch["prepaid/remainingSeconds"], 3600);
  assert.equal(charge.patch["prepaid/amountKrw"], 15000);
  assert.equal(charge.patch["prepaid/kind"], "hour");
  assert.equal(charge.entry.deltaKrw, -15000);
  assert.equal(charge.entry.type, "charge");
  const short = org.chargePatch({ balance: 1000, languages: ["ko", "en"], now: 1000 });
  assert.equal(short.ok, false);
  const half = org.halfPatch({
    balance: 10000,
    languages: ["ko", "en"],
    now: 2000,
    who: "uid123456",
    churchId: "grace-1",
  });
  assert.equal(half.ok, true);
  assert.equal(half.patch["prepaid/remainingSeconds"], 1800);
  assert.equal(half.patch["prepaid/amountKrw"], 7500);
  const tick = org.tickPatch(charge.prepaid, 30, 3000);
  assert.equal(tick.expired, false);
  assert.equal(tick.patch["prepaid/remainingSeconds"], 3570);
  assert.equal(tick.patch["prepaid/amountKrw"], 15000);
  const credit = org.creditPatch({ balance: 5000, amount: 15000, churchId: "grace-1", who: "admin", now: 4000 });
  assert.equal(credit.ok, true);
  assert.equal(credit.balance, 20000);
  assert.equal(credit.patch.balance, 20000);
  assert.equal(credit.entry.deltaKrw, 15000);
});

test("phone apps are two installable entry points on the existing pages", () => {
  const lecture = read("docs/lecture/index.html");
  const face = read("docs/face/index.html");
  const desk = read("broadcast/renderer/index.html");
  const renderer = read("broadcast/renderer/renderer.js");
  const main = read("broadcast/main.js");
  const rules = JSON.parse(read("firebase/live-interpret.rules.json"));
  const church = rules["live-interpret"].churches.$churchId;
  const offer = read("docs/js/phone-offer.js");
  assert.match(lecture, /id="name"/);
  assert.match(lecture, /id="openMic"/);
  assert.match(lecture, /phone-offer\.js/);
  assert.match(offer, /phoneLinks/);
  assert.match(offer, /RTCPeerConnection/);
  assert.match(offer, /stun:stun\.l\.google\.com:19302/);
  assert.match(lecture, /manifest\.webmanifest/);
  assert.match(lecture, /sw-register\.js/);
  assert.match(read("docs/lecture/sw-register.js"), /serviceWorker/);
  assert.match(read("docs/face/sw-register.js"), /serviceWorker/);
  assert.match(face, /id="startFace"/);
  assert.match(face, /id="hostLang"/);
  assert.match(face, /id="guestLang"/);
  assert.match(face, /id="qr"/);
  assert.match(face, /guestJoin/);
  assert.match(face, /manifest\.webmanifest/);
  assert.equal(org.lectureAppUrl("https://anyplan75.github.io/live-interpret"), "https://anyplan75.github.io/live-interpret/lecture/");
  assert.equal(
    org.faceJoinUrl("https://anyplan75.github.io/live-interpret", "a".repeat(32)),
    `https://anyplan75.github.io/live-interpret/face/?s=${"a".repeat(32)}`
  );
  assert.equal(JSON.parse(read("docs/lecture/manifest.webmanifest")).display, "standalone");
  assert.equal(JSON.parse(read("docs/face/manifest.webmanifest")).display, "standalone");
  assert.equal(fs.readFileSync(path.join(root, "docs/lecture/icon-192.png")).subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  assert.match(desk, /id="adminDesk"/);
  assert.match(desk, /id="regLecture"/);
  assert.match(desk, /id="regFace"/);
  assert.match(desk, /id="regKind"/);
  assert.match(desk, /id="adminRates"/);
  assert.match(renderer, /adminMeta/);
  assert.match(renderer, /adminRegister/);
  assert.match(main, /publishLectureToken/);
  assert.match(main, /live\/micToken/);
  const packed = JSON.parse(read("package.json")).build.files;
  assert.ok(packed.includes("docs/js/org-services.js"));
  assert.ok(packed.includes("docs/js/cost.js"));
  assert.ok(packed.includes("docs/js/church-find.js"));
  assert.ok(packed.includes("docs/js/identity.js"));
  assert.equal(church.services.lecture[".write"].includes("admin/uid"), true);
  assert.equal(church.services.face[".write"].includes("admin/uid"), true);
  assert.match(church.services.lecture[".validate"], /!newData\.child\('rate'\)\.exists\(\)/);
  assert.match(church.live.micToken[".write"], /services\/lecture\/registered/);
  assert.match(church.live.micToken[".validate"], /\[a-f0-9\]\{32\}/);
  assert.match(church.orgKind[".validate"], /company/);
  assert.doesNotMatch(read("docs/mic/index.html"), /orgKind|대면 통역/);
});

test("a speech turn does not keep the key in the error", async () => {
  const wav = speech.wavBytes(new Int16Array([0, 1, -1]), 24000);
  assert.equal(Buffer.from(wav.subarray(0, 4)).toString(), "RIFF");
  const secret = `sk-${"c".repeat(20)}`;
  await assert.rejects(
    () => speech.translateLine("안녕", {
      apiKey: secret,
      sourceLang: "ko",
      targetLang: "en",
      fetchImpl: async () => ({
        ok: false,
        status: 401,
        json: async () => ({ error: { message: `bad ${secret}` } }),
      }),
    }),
    (err) => {
      assert.equal(String(err.message).includes(secret), false);
      assert.match(err.message, /\[key\]/);
      return true;
    }
  );
  const heard = await speech.transcribePcm(new Int16Array(4800), {
    apiKey: secret,
    transcriptionLanguage: "ko",
    fetchImpl: async (_url, init) => {
      assert.equal(init.body instanceof FormData, true);
      return { ok: true, status: 200, json: async () => ({ text: "안녕하세요" }) };
    },
  });
  assert.equal(heard, "안녕하세요");
});
