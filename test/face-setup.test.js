const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const org = require("../docs/js/org-services.js");

const known = (code) => code === "ko" || code === "en" || code === "ja";

test("face party is only 2 or 3 people at 2500 won each hour", () => {
  assert.equal(org.FACE_PERSON_KRW, 2500);
  assert.equal(org.FACE_BLOCK_SECONDS, 3600);
  assert.equal(org.FACE_MAX_PEOPLE, 3);
  assert.equal(org.facePartySize(2).ok, true);
  assert.equal(org.facePartySize(2).amount, 5000);
  assert.equal(org.facePartySize(3).ok, true);
  assert.equal(org.facePartySize(3).amount, 7500);
  assert.equal(org.facePartySize(1).ok, false);
  assert.equal(org.facePartySize(4).ok, false);
  assert.match(org.facePartySize(4).reason, /3명을 넘길 수 없습니다/);
});

test("interpretation waits until the chosen setup is complete", () => {
  const waiting = org.faceSetupReady({
    people: 2,
    mode: "qr",
    host: { name: "김", spoken: "ko" },
    guests: [],
    knownLang: known,
  });
  assert.equal(waiting.ok, false);

  const two = org.faceSetupReady({
    people: 2,
    mode: "qr",
    host: { name: "김", spoken: "ko" },
    guests: [{ name: "Ann", spoken: "en" }],
    knownLang: known,
  });
  assert.equal(two.ok, true);
  assert.equal(two.amount, 5000);
  assert.equal(two.roster.length, 2);

  const partial = org.faceSetupReady({
    people: 3,
    mode: "qr",
    host: { name: "김", spoken: "ko" },
    guests: [{ name: "Ann", spoken: "en" }],
    knownLang: known,
  });
  assert.equal(partial.ok, false);

  const three = org.faceSetupReady({
    people: 3,
    mode: "qr",
    host: { name: "김", spoken: "ko" },
    guests: [
      { name: "Ann", spoken: "en" },
      { name: "Lin", spoken: "ja" },
    ],
    knownLang: known,
  });
  assert.equal(three.ok, true);
  assert.equal(three.amount, 7500);
  assert.equal(three.roster.length, 3);

  const soloWait = org.faceSetupReady({
    people: 3,
    mode: "solo",
    peopleList: [
      { name: "김", spoken: "ko" },
      { name: "Ann", spoken: "" },
      { name: "Lin", spoken: "ja" },
    ],
    knownLang: known,
  });
  assert.equal(soloWait.ok, false);
  assert.match(soloWait.reason, /언어를 선택/);

  const solo = org.faceSetupReady({
    people: 3,
    mode: "solo",
    peopleList: [
      { name: "김", spoken: "ko" },
      { name: "Ann", spoken: "en" },
      { name: "Lin", spoken: "ja" },
    ],
    knownLang: known,
  });
  assert.equal(solo.ok, true);
  assert.equal(solo.amount, 7500);

  const same = org.faceSetupReady({
    people: 2,
    mode: "solo",
    peopleList: [
      { name: "김", spoken: "ko" },
      { name: "박", spoken: "ko" },
    ],
    knownLang: known,
  });
  assert.equal(same.ok, false);
});

test("face page asks for the party size before it can start", () => {
  const face = fs.readFileSync(path.join(__dirname, "..", "docs/face/index.html"), "utf8");
  assert.match(face, /id="count2"/);
  assert.match(face, /id="count3"/);
  assert.equal(face.includes('id="count4"'), false);
  assert.match(face, /3명을 넘길 수 없습니다/);
  assert.match(face, /id="modeQr"/);
  assert.match(face, /id="modeSolo"/);
  assert.match(face, /id="guestSpoken"/);
  assert.match(face, /id="placeLine"/);
  assert.match(face, /placeLabel|placeName/);
  assert.match(face, /faceSetupReady/);
  const start = face.slice(face.indexOf("async function beginInterpretation"));
  assert.match(start, /currentSetup\(\)[\s\S]*chargePeople/);
  assert.match(start, /openLocalMic/);
  assert.equal(face.includes("phone-firebase-env.js"), true);
  const sw = fs.readFileSync(path.join(__dirname, "..", "docs/face/sw.js"), "utf8");
  assert.match(sw, /face-shell-v4/);
  assert.match(face, /시간당/);
  assert.match(face, /charge\.remainingSeconds/);
  assert.equal(face.includes("5,000"), false);
  assert.equal(face.includes("10,000"), false);
  assert.equal(face.includes("15,000"), false);
});
