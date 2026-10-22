const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const { PhoneJoin, publicMicUrl, parseIce } = require("../broadcast/lib/phone-join");
const { downsampleFloatToPcm16 } = require("../broadcast/lib/pcm16");
const { createSubtitleBoard } = require("../broadcast/lib/subtitle-board");
const { Engine, normalizeChannelRows, channelRecognition } = require("../broadcast/lib/engine");
const speakerLines = require("../docs/js/speaker-lines");

const root = path.join(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

function phoneCard(html) {
  const start = html.indexOf('id="phoneJoinCard"');
  const end = html.indexOf('<div class="card">', start);
  assert.ok(start > 0 && end > start);
  return html.slice(start, end);
}

test("a phone joins from the public https page and keeps the name on the subtitle", () => {
  const token = "a".repeat(32);
  assert.equal(
    publicMicUrl("https://anyplan75.github.io/live-interpret", token),
    `https://anyplan75.github.io/live-interpret/mic/?s=${token}`
  );
  assert.throws(() => publicMicUrl("http://anyplan75.github.io/live-interpret", token));
  assert.throws(() => publicMicUrl("https://192.168.0.20", token));
  const page = read("docs/mic/index.html");
  const card = phoneCard(read("broadcast/renderer/index.html"));
  const main = read("broadcast/main.js");
  const rules = JSON.parse(read("firebase/live-interpret.rules.json"));
  const phoneLinks = rules["live-interpret"].phoneLinks.$token;
  assert.match(page, /송출 컴퓨터/);
  assert.match(card, /송출 컴퓨터/);
  assert.match(page, /isSecureContext/);
  assert.match(page, /getUserMedia/);
  assert.match(page, /id="name"/);
  assert.match(page, /id="openMic"/);
  assert.match(page, /RTCPeerConnection/);
  assert.match(page, /stun:stun\.l\.google\.com:19302/);
  assert.match(page, /downsampleFloatToPcm16/);
  assert.doesNotMatch(page, /id="name"[^>]*\bhidden\b|id="openMic"[^>]*\bhidden\b/);
  assert.doesNotMatch(page, /설교|교회|이 컴퓨터|인증서|certificate|unsafe|mobileconfig/i);
  assert.doesNotMatch(card, /설교|교회|이 컴퓨터|인증서|certificate|unsafe|mobileconfig/i);
  assert.doesNotMatch(card, /phoneCertUrl/);
  assert.match(main, /WebRtcHideLocalIpsWithMdns/);
  assert.doesNotMatch(main, /certDir|lan-cert|phoneCertUrl/);
  assert.match(phoneLinks[".read"], /\[a-f0-9\]\{32\}/);
  assert.equal(phoneLinks[".write"], undefined);
  assert.match(phoneLinks.peers.$peerId.offer[".write"], /!data\.exists\(\)/);
  assert.match(phoneLinks.peers.$peerId.offer[".write"], /12000/);
  assert.match(phoneLinks.peers.$peerId.phoneIce.$iceId[".write"], /2000/);
  assert.match(phoneLinks.peers.$peerId.macIce.$iceId[".write"], /2000/);
  assert.match(read("broadcast/renderer/renderer.js"), /renderChannels\(state\.audio\.deviceChannels\)/);
  assert.match(read("broadcast/renderer/renderer.js"), /channel-spoken/);
  assert.match(read("docs/js/viewer.js"), /LI\.speakerLines\.entries/);
  assert.match(read("docs/js/viewer.js"), /class="speaker"/);
  const ice = parseIce(JSON.stringify({
    candidate: "candidate:1 1 udp 2122260223 192.168.0.20 54321 typ host",
    sdpMid: "0",
    sdpMLineIndex: 0,
  }));
  assert.match(ice.candidate, /192\.168\.0\.20/);
  assert.equal(parseIce(JSON.stringify({
    candidate: "candidate:1 1 udp 1 1.2.3.4 9 typ relay",
    sdpMid: "0",
    sdpMLineIndex: 0,
  })), null);
});

test("one connection id stays on the first device until it leaves", () => {
  const org = require("../docs/js/org-services");
  const sent = [];
  const closed = [];
  const join = new PhoneJoin({
    onHello: (phone) => ({ index: 1, name: phone.name, phoneId: phone.id }),
  });
  join.token = "a".repeat(32);
  join.sessionOpen = true;
  join.desks = [{
    connectionId: "AB234K",
    pin: "4821",
    holderPeerId: "",
    phoneId: "",
    name: "",
    spoken: "",
    channelIndex: -1,
  }];
  join.attachLink({
    send(_peerId, text) { sent.push(JSON.parse(text)); },
    close(peerId) { closed.push(peerId); },
  });
  const hello = (peerId, name, phoneId, pin, spoken) => {
    join.ingestText(peerId, JSON.stringify({
      type: "hello", name, phoneId, pin, spoken, connectionId: "AB234K",
    }));
  };
  hello("peerone01", "김", "phoneidphoneid01", "4821", "ko");
  hello("peertwo02", "이", "phoneidphoneid02", "4821", "en");
  assert.equal(sent.some((row) => row.type === "joined" && row.name === "김"), true);
  const refused = sent.find((row) => row.type === "error");
  assert.match(refused.message, /이미 다른 기기/);
  assert.deepEqual(closed, ["peertwo02"]);
  join.peerLeft("peerone01");
  hello("peerlang0", "오", "phoneidphoneid05", "4821", "");
  assert.equal(sent.filter((row) => row.type === "joined" && row.name === "오").length, 1);
  join.peerLeft("peerlang0");
  hello("peerthree", "박", "phoneidphoneid03", "4821", "ja");
  assert.equal(sent.filter((row) => row.type === "joined").length, 3);
  hello("peerfour4", "최", "phoneidphoneid04", "0000", "ko");
  assert.match(sent[sent.length - 1].message, /암호가 맞지/);
  assert.equal(org.normalizeConnectionId("ab-234k"), "AB234K");
  assert.equal(org.normalizeConnectionId("AB2340"), "");
  assert.equal(org.validSessionPin("4821"), true);
  assert.equal(org.validSessionPin("482"), false);
  assert.equal(org.makeConnectionId(Buffer.from([0, 1, 2, 3, 4, 5])).length, 6);
  assert.equal(org.makeSessionPin(Buffer.from([0, 42])), "0042");
  const lecture = read("docs/lecture/index.html");
  const card = phoneCard(read("broadcast/renderer/index.html"));
  const rules = JSON.parse(read("firebase/live-interpret.rules.json"));
  const desk = rules["live-interpret"].lectureJoins.$joinId;
  assert.match(lecture, /id="scanQr"/);
  assert.match(lecture, /applyScan/);
  assert.match(lecture, /id="name"/);
  assert.match(lecture, /id="spoken"/);
  assert.match(lecture, /말하는 언어/);
  assert.doesNotMatch(lecture, /id="joinId"/);
  assert.ok(lecture.indexOf('id="scanQr"') < lecture.indexOf('for="name"'));
  assert.ok(lecture.indexOf('for="name"') < lecture.indexOf('for="spoken"'));
  assert.doesNotMatch(lecture, /spoken:\s*["']ko["']/);
  assert.doesNotMatch(lecture, /id="joinPin"|id="phoneQr"|qrcode|접속\s*번호|4자리/);
  const pageVC = read("ios/LiveInterpret/PageViewController.swift");
  const phonePages = read("ios/LiveInterpret/PhonePages.swift");
  const project = read("ios/LiveInterpret.xcodeproj/project.pbxproj");
  assert.match(pageVC, /page == \.lecture/);
  assert.match(pageVC, /loadBundledLecture/);
  assert.match(pageVC, /loadHTMLString/);
  assert.match(pageVC, /sw-register\.js/);
  assert.match(pageVC, /forResource: "index"/);
  assert.match(pageVC, /scanLecture/);
  assert.match(pageVC, /lectureSlot/);
  assert.match(phonePages, /phone-booth/);
  assert.match(phonePages, /func lectureSlot/);
  assert.match(read("ios/LiveInterpret/PhonePages.swift"), /isRemoteLecturePage/);
  assert.match(pageVC, /isRemoteLecturePage/);
  assert.match(project, /\.\.\/\.\.\/docs\/lecture\/index\.html/);
  assert.equal(lecture.indexOf("languages.js") < lecture.indexOf("catalog.js"), true);
  assert.match(card, /id="phoneDesks"/);
  assert.match(card, /id="phoneCount"/);
  assert.match(card, /QR/);
  assert.doesNotMatch(card, /암호/);
  assert.doesNotMatch(card, /id="addPhoneChannel"|id="phoneQr"|id="phoneJoinUrl"|이번 세션 4자리 암호/);
  assert.doesNotMatch(card, /id="joinId"|id="joinPin"/);
  assert.match(read("broadcast/renderer/renderer.js"), /onChannelSpoken\(/);
  assert.match(read("broadcast/preload.js"), /setPhoneCount/);
  const setCount = read("broadcast/main.js");
  const handler = setCount.slice(setCount.indexOf('ipcMain.handle("phone:set-count"'), setCount.indexOf('ipcMain.handle("phone:add-channel"'));
  assert.ok(handler.indexOf("ensureAuth") < handler.indexOf("lectureJoins"));
  assert.match(desk[".read"], /ABCDEFGHJKLMNPQRSTUVWXYZ23456789/);
  assert.match(desk[".write"], /!newData\.child\('pin'\)\.exists\(\)/);
  assert.match(desk[".write"], /!newData\.child\('password'\)\.exists\(\)/);
  assert.doesNotMatch(read("broadcast/main.js"), /4자리 암호: \$\{|sessionPin|\.pin\b/);
  const packaged = JSON.parse(read("package.json")).build.files;
  assert.ok(packaged.includes("docs/js/org-services.js"));
  assert.ok(packaged.includes("docs/js/cost.js"));
  assert.ok(packaged.includes("docs/js/speaker-lines.js"));
  const screen = read("broadcast/renderer/renderer.js");
  assert.match(screen, /휴대폰\$\{slot\} \$\{who\} 켜짐/);
  assert.match(screen, /function phoneJoined/);
  assert.match(screen, /started\.already/);
  assert.match(screen, /이미 방송 중입니다/);
  assert.match(read("broadcast/main.js"), /started\.already/);
  assert.match(read("broadcast/lib/engine.js"), /broadcastLive/);
  assert.doesNotMatch(screen, /휴대폰\$\{slot\} 켜짐/);
  assert.match(screen, /아직 연결되지 않았습니다/);
  assert.match(screen, /appendPhoneLive\(wrap/);
  assert.match(screen, /showPreacherName/);
  assert.match(screen, /preacherNameShown/);
  assert.match(screen, /data-phone-level/);
  assert.match(read("broadcast/renderer/index.html"), /id="phoneLevels"/);
  assert.match(read("broadcast/renderer/index.html"), /id="showPreacherName"/);
  assert.match(read("broadcast/renderer/index.html"), /강연자 이름을 자막에 표시/);
  assert.match(read("broadcast/preload.js"), /setShowPreacherName/);
  assert.match(read("broadcast/preload.js"), /setPhoneDisplay/);
  assert.match(read("broadcast/lib/engine.js"), /setShowPreacherName/);
  assert.match(read("broadcast/lib/engine.js"), /setPhoneDisplay/);
  assert.match(screen, /이 이름을 자막에 표시/);
  assert.match(screen, /phone-qr/);
  assert.match(screen, /qrDataUrl/);
  assert.match(read("broadcast/lib/phone-join.js"), /refreshQrs/);
  assert.match(read("docs/lecture/index.html"), /type: "hello", name/);
  assert.doesNotMatch(screen, /음성 신호가 들어오고 있습니다/);
  assert.doesNotMatch(screen, /음성 신호가 아직 없습니다/);
  assert.doesNotMatch(screen, /연결됨/);
  assert.doesNotMatch(screen, /마이크가 입력입니다/);
});

test("the packaged app includes every file the main process requires", () => {
  const root = path.join(__dirname, "..");
  const patterns = JSON.parse(read("package.json")).build.files;
  function packed(rel) {
    const normal = rel.split(path.sep).join("/");
    return patterns.some((pattern) => {
      if (pattern.endsWith("/**/*")) return normal.startsWith(pattern.slice(0, -5));
      return normal === pattern;
    });
  }
  const seen = new Set();
  function walk(file) {
    const rel = path.relative(root, file);
    if (seen.has(rel)) return;
    seen.add(rel);
    assert.equal(packed(rel), true, rel);
    if (!rel.endsWith(".js")) return;
    const text = fs.readFileSync(file, "utf8");
    const specs = [...text.matchAll(/require\(\s*["'](\.[^"']+)["']\s*\)/g)].map((match) => match[1]);
    [...text.matchAll(/path\.join\(\s*__dirname\s*,\s*["']([^"']+\.js)["']\s*\)/g)].forEach((match) => {
      specs.push(`./${match[1]}`);
    });
    specs.forEach((spec) => {
      let target = path.resolve(path.dirname(file), spec);
      if (!path.extname(target)) {
        if (fs.existsSync(`${target}.js`)) target = `${target}.js`;
        else if (fs.existsSync(path.join(target, "index.js"))) target = path.join(target, "index.js");
      }
      if (!target.startsWith(root)) return;
      walk(target);
    });
  }
  walk(path.join(root, "broadcast/main.js"));
  assert.ok(seen.has(path.join("docs/js", "speaker-lines.js")));
  assert.ok(seen.has(path.join("docs/js", "languages.js")));
  assert.ok(seen.has(path.join("docs/js", "cost.js")));
});

test("a live broadcast is kept and a stuck flag is cleared", async () => {
  const live = new Engine(() => {});
  live.running = true;
  live.channelSessions = new Map([[0, { speech: {}, pipeline: {} }]]);
  live.church = { id: "grace-ab", name: "계정" };
  live.folderName = "2026";
  live.sessionDir = "/tmp/live";
  live.targets = ["en"];
  live.channelRows = [{ spoken: "ko", on: true, source: "device" }];
  const again = await live.start({});
  assert.equal(again.already, true);
  assert.equal(live.running, true);
  assert.equal(again.channels[0].spoken, "ko");

  const stuck = new Engine(() => {});
  stuck.running = true;
  stuck.channelSessions = new Map();
  await assert.rejects(() => stuck.start({}), /OpenAI 키/);
  assert.equal(stuck.running, false);
});

test("hiding the preacher name clears only the Mac speaker", () => {
  const engine = new Engine(() => {});
  engine.preacherName = "이종찬";
  engine.showPreacherName = true;
  engine.channelRows = [
    { spoken: "ko", on: true, source: "device", name: "" },
    { spoken: "ko", on: true, source: "phone", name: "민수", phoneId: "phone0001" },
  ];
  const device = { name: "이종찬", pipeline: { speaker: "이종찬" } };
  const phone = { name: "민수", pipeline: { speaker: "민수" } };
  engine.channelSessions = new Map([[0, device], [1, phone]]);
  assert.equal(engine.deviceSpeaker(engine.channelRows[0], 0), "이종찬");
  assert.equal(engine.deviceSpeaker(engine.channelRows[1], 1), "");
  assert.equal(engine.setShowPreacherName(false).showPreacherName, false);
  assert.equal(device.name, "");
  assert.equal(device.pipeline.speaker, "");
  assert.equal(phone.name, "민수");
  assert.equal(phone.pipeline.speaker, "민수");
  engine.setShowPreacherName(true);
  assert.equal(device.pipeline.speaker, "이종찬");
  assert.equal(phone.pipeline.speaker, "민수");
});

test("a Mac rename replaces one phone name and hiding drops only that phone", () => {
  const engine = new Engine(() => {});
  engine.preacherName = "이종찬";
  engine.showPreacherName = true;
  engine.channelRows = [{ spoken: "ko", on: true, source: "device" }];
  const first = engine.addPhone({ id: "phone0001", name: "홍길동", spoken: "ko", connectionId: "AB234K" });
  const second = engine.addPhone({ id: "phone0002", name: "민수", spoken: "en", connectionId: "CD456M" });
  assert.equal(first.name, "홍길동");
  assert.equal(engine.publicChannels()[first.index].showName, true);
  const devicePipe = { speaker: "이종찬" };
  const firstPipe = { speaker: "홍길동" };
  const secondPipe = { speaker: "민수" };
  engine.channelSessions = new Map([
    [0, { name: "이종찬", pipeline: devicePipe }],
    [first.index, { name: "홍길동", pipeline: firstPipe }],
    [second.index, { name: "민수", pipeline: secondPipe }],
  ]);
  const renamed = engine.setPhoneDisplay("ab234k", { name: "김집사" });
  assert.equal(renamed.name, "김집사");
  assert.equal(renamed.showName, true);
  assert.equal(firstPipe.speaker, "김집사");
  assert.equal(secondPipe.speaker, "민수");
  assert.equal(devicePipe.speaker, "이종찬");
  engine.setPhoneDisplay("AB234K", { showName: false });
  assert.equal(engine.channelRows[first.index].name, "김집사");
  assert.equal(firstPipe.speaker, "");
  assert.equal(secondPipe.speaker, "민수");
  assert.equal(devicePipe.speaker, "이종찬");
  engine.setShowPreacherName(false);
  assert.equal(devicePipe.speaker, "");
  assert.equal(secondPipe.speaker, "민수");
  assert.equal(firstPipe.speaker, "");
  assert.equal(channelRecognition({ source: "phone", spoken: "ko", name: "김집사", showName: false }, ["en"]).speaker, "");
  assert.equal(channelRecognition({ source: "phone", spoken: "ko", name: "김집사" }, ["en"]).speaker, "김집사");
  assert.throws(() => engine.setPhoneDisplay("AB234K", { name: "   " }), /이름을 입력해 주세요/);
  assert.equal(engine.channelRows[first.index].name, "김집사");
});

test("a connected phone shows a signal only after audio arrives", async () => {
  const events = [];
  const engine = new Engine((payload) => events.push(payload));
  engine.channelRows = [{ spoken: "ko", on: true, source: "device" }];
  engine.addPhone({ id: "phone0009", name: "왕웨이", spoken: "zh-CN", connectionId: "AB234K" });
  const levels = () => events.filter((event) => event.type === "level" && event.channel === 1);
  engine.pushPhonePcm("phone0009", Buffer.alloc(4800));
  assert.equal(engine.channelRows[1].signal, undefined);
  assert.equal(engine.publicChannels()[1].signal, false);
  assert.equal(levels().at(-1).peak, 0);
  const loud = Buffer.alloc(4800);
  for (let i = 0; i < loud.length; i += 2) loud.writeInt16LE(8000, i);
  engine.pushPhonePcm("phone0009", loud);
  assert.equal(engine.channelRows[1].signal, true);
  assert.equal(engine.publicChannels()[1].signal, true);
  assert.ok(levels().at(-1).peak > 0.2);
  assert.equal(events.some((event) => event.type === "phones" && event.channels[1] && event.channels[1].signal), true);
  await new Promise((resolve) => setTimeout(resolve, 1600));
  assert.equal(engine.channelRows[1].signal, false);
  assert.equal(levels().at(-1).peak, 0);
  engine.markPhoneAway("phone0009");
  assert.equal(engine.channelRows[1].signal, false);
  assert.equal(levels().at(-1).peak, 0);
});

test("pcm from a phone mic is 24 kHz int16", () => {
  const pcm = downsampleFloatToPcm16(new Float32Array(480), 48000, 24000);
  assert.equal(pcm.length, 240);
  assert.equal(pcm.constructor, Int16Array);
  const full = downsampleFloatToPcm16(Float32Array.from([1, -1]), 16000, 16000);
  assert.equal(full[0], 32767);
  assert.equal(full[1], -32768);
});

test("two named lines stay together when both phones speak", () => {
  const board = createSubtitleBoard();
  board.merge({
    _timestamp: 1,
    en: { text: "hello", id: "a1", isFinal: false, name: "민수", channelKey: "pphone0001" },
  });
  const both = board.merge({
    _timestamp: 2,
    en: { text: "hola", id: "b1", isFinal: true, name: "영희", channelKey: "pphone0002" },
  });
  assert.equal(both.en.lines.pphone0001.text, "hello");
  assert.equal(both.en.lines.pphone0001.name, "민수");
  assert.equal(both.en.lines.pphone0002.text, "hola");
  assert.equal(both.en.lines.pphone0002.name, "영희");
  const shown = speakerLines.entries(both.en);
  assert.deepEqual(shown.map((line) => line.caption), ["민수: hello", "영희: hola"]);
  const single = board.merge({
    ko: { text: "안녕", id: "k1", isFinal: true },
  });
  assert.equal(single.ko.lines, undefined);
  assert.equal(single.ko.text, "안녕");
});

test("a phone is an extra input and the first input stays included", async () => {
  const rows = normalizeChannelRows([
    { spoken: "ko", on: true },
    { source: "phone", name: "민수", phoneId: "phone0001", spoken: "en", on: true },
  ], 1, "ko");
  assert.equal(rows[0].source, "device");
  assert.equal(rows[1].name, "민수");
  assert.equal(rows[1].on, true);

  const engine = new Engine(() => {});
  engine.device = { inputChannels: 1 };
  engine.channelRows = [{ spoken: "ko", on: true, source: "device" }];
  const added = engine.addPhone({ id: "phone0001", name: "민수", spoken: "en", connectionId: "AB234K" });
  assert.equal(added.index, 1);
  assert.equal(added.spoken, "en");
  assert.equal(engine.channelRows[0].source, "device");
  assert.equal(engine.channelRows[1].name, "민수");
  assert.equal(engine.channelRows[1].spoken, "en");
  assert.throws(() => engine.addPhone({ id: "phone0003", name: "철수" }), /말하는 언어/);
  const second = engine.addPhone({ id: "phone0002", name: "영희", spoken: "ja" });
  assert.equal(second.index, 2);
  assert.equal(second.spoken, "ja");

  engine.running = true;
  engine.church = { id: "grace-ab", accountUid: "user" };
  engine.sessionCharge = { charged: 15000, balance: 40000 };
  engine.outputs = ["en"];
  engine.paidChannels = new Set();
  const opened = [];
  engine.openChannel = async (index) => { opened.push(index); };
  engine.writeBilling = async (_id, balance) => {
    engine.sessionCharge.balance = balance;
  };
  const included = await engine.setChannelOn("", 0, true);
  assert.equal(included.on, true);
  assert.equal(engine.sessionCharge.charged, 15000);
  const phone = await engine.setChannelOn("", 1, true);
  assert.equal(phone.on, true);
  assert.equal(engine.sessionCharge.charged, 25000);
  assert.equal(engine.sessionCharge.balance, 30000);
  await engine.setChannelOn("", 1, true);
  assert.equal(engine.sessionCharge.charged, 25000);
  assert.deepEqual(opened, [0, 1, 1]);

  const deviceFed = [];
  const phoneFed = [];
  engine.channelSessions = new Map([
    [0, { source: "device", speech: { push(buf) { deviceFed.push(buf); } } }],
    [1, { source: "phone", speech: { push(buf) { phoneFed.push(buf); } } }],
  ]);
  engine.pushPhonePcm("phone0001", Buffer.from([0, 16, 0, 32]));
  assert.equal(phoneFed.length, 1);
  assert.equal(deviceFed.length, 0);
  engine._onPcm(Buffer.alloc(3 * 2 * 8), {
    nChannels: 3,
    sampleRate: 48000,
    mode: "all",
    deviceChannels: 3,
    deviceChannel: 0,
    selected: 0,
  });
  assert.equal(deviceFed.length, 1);
  assert.equal(phoneFed.length, 1);

  const seen = [];
  engine.channelSessions.set(1, {
    spoken: "en",
    source: "phone",
    pipeline: { setSourceLang(code) { seen.push(code); } },
    speech: { async setLanguage(code) { seen.push(`speech:${code}`); } },
  });
  engine.outputs = ["en"];
  await engine.applyChannelSpoken("", 1, "ja");
  assert.equal(engine.channelRows[1].spoken, "ja");
  assert.deepEqual(seen, ["ja", "speech:ja"]);
  engine.addPhone({ id: "phone0001", name: "민수", spoken: "en", connectionId: "AB234K" });
  assert.equal(engine.channelRows[1].spoken, "ja");
  engine.addPhone({ id: "phone0009", name: "철수", spoken: "zh-CN", connectionId: "AB234K" });
  assert.equal(engine.channelRows[1].name, "철수");
  assert.equal(engine.channelRows[1].spoken, "zh-CN");
  assert.equal(engine.channelRows.filter((row) => row.source === "phone").length, 2);
});

test("a phone that looks connected also feeds the translator", async () => {
  const { pcmFromSignal } = require("../broadcast/lib/phone-join");
  const engine = new Engine(() => {});
  engine.device = { inputChannels: 1 };
  engine.channelRows = [{ spoken: "ko", on: true, source: "device" }];
  engine.running = true;
  engine.church = { id: "grace-ab", accountUid: "user" };
  engine.sessionCharge = { charged: 15000, balance: 40000 };
  engine.outputs = ["en"];
  engine.paidChannels = new Set();
  engine.syncSettings = async () => {};
  engine.writeBilling = async (_id, balance) => { engine.sessionCharge.balance = balance; };
  const fed = [];
  let release = null;
  engine.openChannel = (index) => new Promise((resolve) => {
    release = () => {
      engine.channelSessions.set(index, {
        source: "phone",
        speech: { push(buf) { fed.push(Buffer.from(buf)); } },
      });
      resolve();
    };
  });
  const pending = engine.acceptPhone({ id: "phone0001", name: "민수", spoken: "ko", connectionId: "AB234K" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(typeof release, "function");
  assert.equal(engine.channelRows[1].connected, true);
  assert.equal(engine.channelSessions.has(1), false);
  engine.pushPhonePcm("phone0001", Buffer.from([1, 0, 1, 0]));
  assert.equal(fed.length, 0);
  release();
  const joined = await pending;
  assert.equal(joined.listening, true);
  assert.equal(engine.channelRows[1].on, true);
  assert.equal(fed.length, 1);
  engine.pushPhonePcm("phone0001", Buffer.from([2, 0, 2, 0]));
  assert.equal(fed.length, 2);
  assert.equal(engine.sessionCharge.balance, 30000);
  const round = pcmFromSignal(Buffer.from([9, 0, 8, 0]).toString("base64"));
  assert.equal(round.readInt16LE(0), 9);
  const answer = read("broadcast/phone/answer.html");
  const offer = read("docs/js/phone-offer.js");
  const lecture = read("docs/lecture/index.html");
  assert.match(answer, /btoa/);
  assert.match(answer, /arrayBuffer/);
  assert.doesNotMatch(answer, /pcm: message\.data/);
  assert.match(offer, /createMediaStreamDestination/);
  assert.doesNotMatch(offer, /gain\.value = 0/);
  assert.match(lecture, /createMediaStreamDestination/);
  assert.doesNotMatch(lecture, /src="\.\.\/js\/phone-offer\.js"/);
  assert.match(read("broadcast/main.js"), /acceptPhone/);
  assert.match(read("broadcast/lib/consent.js"), /이 계정과 플랫폼 관리자/);
  assert.doesNotMatch(read("broadcast/lib/consent.js"), /교회/);
});

test("named phones join through data-channel messages without a certificate", async () => {
  const joined = [];
  const sent = [];
  let pcmCount = 0;
  const server = new PhoneJoin({
    onHello(phone) {
      joined.push(phone);
      return { index: joined.length, name: phone.name, phoneId: phone.id, listening: false };
    },
    onPcm() { pcmCount += 1; },
    onLeave(phoneId) { joined.push({ left: phoneId }); },
  });
  server.attachLink({
    send(_peerId, text) { sent.push(JSON.parse(text)); },
    close() {},
  });
  try {
    const info = await server.start({ signal: false });
    assert.match(info.url, /^https:\/\/anyplan75\.github\.io\/live-interpret\/mic\/\?s=[a-f0-9]{32}$/);
    assert.equal(info.certUrl, undefined);
    assert.equal(info.url.includes("http://"), false);
    assert.match(info.qrDataUrl, /^data:image\/png;base64,/);
    server.ingestText("peer0001aa", JSON.stringify({ type: "hello", name: "민수", phoneId: "phone0001", pin: "1234", spoken: "ko" }));
    assert.match(sent.at(-1).message, /이 QR의 칸을 찾지 못했습니다/);
    assert.equal(server.info().loginError, "이 QR의 칸을 찾지 못했습니다.");
    const first = await server.openSession();
    const second = server.addDesk();
    assert.equal(first.connectionId.length, 6);
    assert.equal(second.connectionId.length, 6);
    assert.notEqual(first.connectionId, second.connectionId);
    assert.equal(first.pin, undefined);
    const desks = server.info();
    assert.equal(desks.channels.length, 2);
    assert.equal(desks.url.includes(desks.channels[0].pin), false);
    assert.equal(desks.url.includes(desks.channels[1].pin), false);
    assert.equal(desks.url, "https://anyplan75.github.io/live-interpret/lecture/");
    const pinA = desks.channels[0].pin;
    const pinB = desks.channels[1].pin;
    server.ingestPcm("peer0001aa", Buffer.from([0, 1]));
    assert.equal(pcmCount, 0);
    server.ingestText("peer0001aa", JSON.stringify({
      type: "hello", name: "민수", phoneId: "phone0001", pin: pinA, connectionId: first.connectionId,
    }));
    assert.equal(joined[0] && joined[0].spoken, "ko");
    server.ingestText("peer0002bb", JSON.stringify({
      type: "hello", name: "영희", phoneId: "phone0002", pin: pinB, spoken: "en", connectionId: second.connectionId,
    }));
    server.ingestText("peer0003cc", JSON.stringify({
      type: "hello", name: "철수", phoneId: "phone0003", pin: pinA, spoken: "ja", connectionId: first.connectionId,
    }));
    server.ingestPcm("peer0001aa", Buffer.from([0, 1, 0, 2]));
    server.setListening("phone0001", true);
    assert.equal(sent.some((item) => item.type === "joined" && item.name === "민수"), true);
    assert.equal(sent.some((item) => item.type === "joined" && item.name === "영희"), true);
    assert.match(sent.find((item) => item.type === "error" && /다른 기기/.test(item.message)).message, /다른 기기/);
    assert.equal(sent.some((item) => item.type === "state" && item.listening === true), true);
    assert.deepEqual(joined.map((item) => item.name), ["민수", "영희"]);
    assert.equal(joined[0].spoken, "ko");
    assert.equal(joined[1].spoken, "en");
    assert.equal(pcmCount, 1);
    server.peerLeft("peer0001aa");
    assert.deepEqual(joined.at(-1), { left: "phone0001" });
    server.ingestText("peer0003cc", JSON.stringify({
      type: "hello", name: "철수", phoneId: "phone0003", pin: pinA, spoken: "ja", connectionId: first.connectionId,
    }));
    assert.equal(sent.filter((item) => item.type === "joined" && item.name === "철수").length, 1);
    const ids = server.closeSession();
    assert.deepEqual(ids.slice().sort(), [first.connectionId, second.connectionId].sort());
    assert.equal(server.info().channels.length, 0);
  } finally {
    await server.stop();
  }
});

test("each phone slot has its own lecture QR", async () => {
  const org = require("../docs/js/org-services");
  const token = "ab".repeat(16);
  const server = new PhoneJoin();
  await server.start({ signal: false, token });
  server.setPhoneCount(2);
  await server.refreshQrs();
  const info = server.info();
  assert.equal(info.channels.length, 2);
  assert.match(info.channels[0].qrDataUrl, /^data:image\/png;base64,/);
  assert.match(info.channels[1].qrDataUrl, /^data:image\/png;base64,/);
  assert.notEqual(info.channels[0].connectionId, info.channels[1].connectionId);
  const url = org.lectureSlotUrl("https://anyplan75.github.io/live-interpret", info.channels[0].connectionId, token);
  const parsed = org.parseLectureSlot(url);
  assert.equal(parsed.connectionId, info.channels[0].connectionId);
  assert.equal(parsed.token, token);
  assert.equal(org.parseLectureSlot(`https://evil.example/lecture/?c=${info.channels[0].connectionId}&s=${token}`), null);
  assert.equal(info.channels[0].qrDataUrl.includes(token), false);
  await server.stop();
});

test("the operator picks how many phones and a name plus auth code is enough", async () => {
  const sent = [];
  const server = new PhoneJoin({
    onHello: (phone) => ({ index: 1, name: phone.name, phoneId: phone.id, spoken: phone.spoken }),
  });
  server.attachLink({
    send(_peerId, text) { sent.push(JSON.parse(text)); },
    close() {},
  });
  const prepared = server.setPhoneCount(2);
  assert.equal(prepared.added.length, 2);
  assert.equal(server.sessionOpen, false);
  assert.equal(server.info().channels.length, 2);
  const kept = server.desks.map((desk) => desk.connectionId);
  server.ingestText("peerbefore", JSON.stringify({
    type: "hello", name: "민수", connectionId: kept[0],
  }));
  assert.equal(sent.some((row) => row.type === "joined" && row.name === "민수"), true);
  assert.equal(server.info().channels[0].connected, true);
  assert.equal(server.info().channels[0].name, "민수");
  assert.equal(server.info().channels[0].loginError, "");
  server.ingestText("peerbadlang", JSON.stringify({
    type: "hello", name: "영희", connectionId: kept[1], spoken: "zz",
  }));
  assert.equal(server.info().channels[1].loginError, "말하는 언어를 선택해 주세요.");
  assert.equal(server.info().channels[1].connected, false);
  await server.openSession();
  assert.deepEqual(server.desks.map((desk) => desk.connectionId), kept);
  server.ingestText("peerafter1", JSON.stringify({
    type: "hello", name: "민수", connectionId: kept[0],
  }));
  assert.match(sent.at(-1).message, /다른 기기/);
  assert.throws(() => server.setPhoneCount(9), /0부터 8까지/);
  assert.throws(() => server.setPhoneCount(0), /연결된 휴대폰/);
  const shrunk = server.setPhoneCount(1);
  assert.equal(shrunk.removed.length, 1);
  assert.equal(server.info().channels.length, 1);
  assert.equal(server.info().channels[0].connectionId, kept[0]);
});

function chromeBin() {
  const candidates = [
    process.env.CHROME_PATH,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  ].filter(Boolean);
  return candidates.find((item) => fs.existsSync(item)) || "";
}

function browserSecureContext(bin, url) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "live-interpret-chrome-"));
  const chrome = spawn(bin, [
    "--headless=old",
    "--disable-gpu",
    "--no-first-run",
    "--no-proxy-server",
    "--remote-debugging-port=0",
    `--user-data-dir=${profile}`,
    "about:blank",
  ], { stdio: ["ignore", "ignore", "pipe"] });
  const done = new Promise((resolve, reject) => {
    let buf = "";
    const timer = setTimeout(() => reject(new Error("browser debug port did not open")), 8000);
    chrome.stderr.on("data", (chunk) => {
      buf += chunk.toString();
      const match = buf.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)/);
      if (!match) return;
      clearTimeout(timer);
      resolve(Number(match[1]));
    });
    chrome.on("exit", () => {
      clearTimeout(timer);
      reject(new Error("browser exited before the debug port opened"));
    });
  });
  return done.then(async (port) => {
    const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
    const page = targets.find((item) => item.type === "page");
    const BrowserSocket = globalThis.WebSocket;
    if (!BrowserSocket) throw new Error("this Node has no WebSocket client");
    const ws = new BrowserSocket(page.webSocketDebuggerUrl);
    let seq = 0;
    const pending = new Map();
    ws.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id && pending.has(message.id)) pending.get(message.id)(message);
    });
    await new Promise((resolve, reject) => {
      ws.addEventListener("open", resolve);
      ws.addEventListener("error", reject);
    });
    const send = (method, params) => new Promise((resolve) => {
      const id = ++seq;
      pending.set(id, resolve);
      ws.send(JSON.stringify({ id, method, params }));
    });
    await send("Page.enable");
    await send("Page.navigate", { url });
    await new Promise((resolve) => setTimeout(resolve, 3000));
    const evaluated = await send("Runtime.evaluate", {
      expression: "JSON.stringify({ isSecureContext: window.isSecureContext, hasMedia: !!(navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === 'function'), protocol: location.protocol, host: location.host })",
      returnByValue: true,
    });
    ws.close();
    await closeBrowser(chrome, profile);
    return JSON.parse(evaluated.result.result.value);
  }).catch(async (err) => {
    await closeBrowser(chrome, profile);
    throw err;
  });
}

function closeBrowser(chrome, profile) {
  try { chrome.kill("SIGKILL"); } catch (_) { /* 이미 끝난 브라우저는 넘어갑니다 */ }
  return new Promise((resolve) => {
    const finish = () => {
      try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 80 }); }
      catch (_) { /* 임시 프로필이 남아도 보안 맥락 판정은 유지합니다 */ }
      resolve();
    };
    if (chrome.exitCode != null || chrome.signalCode != null) finish();
    else {
      chrome.once("exit", finish);
      setTimeout(finish, 400);
    }
  });
}

test("plain http hides the microphone and https exposes it", { timeout: 60000 }, async (t) => {
  const bin = chromeBin();
  if (!bin) {
    t.skip("this machine has no desktop browser to check the secure-context rule");
    return;
  }
  const secure = await browserSecureContext(bin, "https://example.com/");
  const insecure = await browserSecureContext(bin, "http://neverssl.com/");
  assert.equal(secure.isSecureContext, true);
  assert.equal(secure.hasMedia, true);
  assert.equal(secure.protocol, "https:");
  assert.equal(insecure.isSecureContext, false);
  assert.equal(insecure.hasMedia, false);
  assert.equal(insecure.protocol, "http:");
  assert.match(publicMicUrl("https://anyplan75.github.io/live-interpret", "b".repeat(32)), /^https:\/\/anyplan75\.github\.io\/live-interpret\/mic\/\?s=b{32}$/);
});
