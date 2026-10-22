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

test("the recognition prompt is not treated as heard speech", () => {
  const prompt = catalog.sttPrompt("서귀포제일교회", "설교자: 이종찬\n말투: 차분함");
  assert.equal(catalog.isGuidanceEcho(prompt), true);
  assert.equal(catalog.isGuidanceEcho("영어는 한 번에 되는데 왜 한국어는 여러 번 말을 하게 나오지?"), false);
  const mixed = "한국 교회 예배입니다. 설교, 기도, 찬송, 광고를 한국어로 받아 씁니다. 조광우 내일을 김밥 싸야 되는데.";
  assert.equal(catalog.stripGuidance(mixed), "조광우 내일을 김밥 싸야 되는데.");
  assert.equal(
    catalog.stripGuidance('그러니까 그러고 또 이제 딴 데 좀 잠사가는 거잖아. 말 끊는 위치(문장이 이어짐): "차분함" 뒤 쉼 32회 — 차분함 / 한국'),
    "그러니까 그러고 또 이제 딴 데 좀 잠사가는 거잖아."
  );
  assert.equal(catalog.sttPrompt("서귀포제일교회", "말 끊는 위치: 쉼\n정확도 교정: 있나 → 있나요\n설교자: 이종찬").includes("정확도 교정"), false);
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

test("one platform key and church activation", () => {
  const sample = `sk-${"a".repeat(12)}`;
  assert.equal(catalog.platformKeyRel, "platform/openaiKey");
  assert.equal(catalog.adminUidRel, "admin/uid");
  assert.equal(catalog.underRoot(catalog.platformKeyRel), "live-interpret/platform/openaiKey");
  assert.equal(catalog.underRoot(catalog.adminUidRel), "live-interpret/admin/uid");
  assert.equal(catalog.canClaimAdmin(null), true);
  assert.equal(catalog.canClaimAdmin(""), true);
  assert.equal(catalog.canClaimAdmin("uid-1"), false);
  assert.equal(catalog.isCurrentAdmin("uid-1", "uid-1"), true);
  assert.equal(catalog.isCurrentAdmin("uid-1", "uid-2"), false);
  assert.equal(catalog.validAdminEmail("a@b.co"), true);
  assert.equal(catalog.validAdminEmail("not-an-email"), false);
  assert.equal(catalog.validAdminPassword("12345"), false);
  assert.equal(catalog.validAdminPassword("123456"), true);
  assert.match(catalog.authErrorMessage({ code: "auth/unauthorized-domain" }), /anyplan75\.github\.io/);
  assert.equal(catalog.firebase.projectId, "live-interpret-db65e");
  assert.equal(catalog.firebase.authDomain, "live-interpret-db65e.firebaseapp.com");
  const expectedKey = process.env.FIREBASE_API_KEY || "";
  assert.equal(catalog.firebase.apiKey === expectedKey, true);
  const catalogSource = fs.readFileSync(path.join(__dirname, "../docs/js/catalog.js"), "utf8");
  assert.equal(/AIza[0-9A-Za-z\-_]{20,}/.test(catalogSource), false);
  assert.equal(catalog.isPlatformKey(sample), true);
  assert.equal(catalog.isPlatformKey("short"), false);
  assert.equal(catalog.redactSecrets(`err ${sample} tail`).includes(sample), false);
  assert.equal(catalog.churchIsActive({ name: "알파" }), true);
  assert.equal(catalog.churchIsActive(null), true);
  assert.equal(catalog.churchIsActive(false), false);
  assert.equal(catalog.churchIsActive({ active: false }), false);
  const { activeChurchesFromIndex } = require("../broadcast/lib/firebase");
  const visible = activeChurchesFromIndex({
    "alpha-ab": { name: "알파", active: true },
    "beta-cd": { name: "베타", active: false },
    "gamma-ef": { name: "감마" },
  });
  assert.deepEqual(visible.map((row) => row.name), ["감마", "알파"]);
});

test("owner and church logins split the controls", () => {
  const root = path.join(__dirname, "..");
  const admin = fs.readFileSync(path.join(root, "docs/admin.html"), "utf8");
  const adminJs = fs.readFileSync(path.join(root, "docs/js/admin.js"), "utf8");
  const broadcast = fs.readFileSync(path.join(root, "broadcast/renderer/index.html"), "utf8");
  const renderer = fs.readFileSync(path.join(root, "broadcast/renderer/renderer.js"), "utf8");
  const main = fs.readFileSync(path.join(root, "broadcast/main.js"), "utf8");
  const listen = fs.readFileSync(path.join(root, "docs/listen.html"), "utf8");
  const overlay = fs.readFileSync(path.join(root, "docs/overlay.html"), "utf8");
  const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");
  const authJs = fs.readFileSync(path.join(root, "docs/js/auth.js"), "utf8");
  const rules = JSON.parse(fs.readFileSync(path.join(root, "firebase/live-interpret.rules.json"), "utf8"));
  const church = rules["live-interpret"].churches.$churchId;
  assert.match(admin, /id="apiKey"/);
  assert.match(admin, /id="toggleActive"/);
  assert.match(admin, /id="saveKey"/);
  assert.match(admin, /id="churchModel"/);
  assert.match(admin, /id="churchEmail"/);
  assert.match(admin, /id="addCompany"/);
  assert.match(admin, /id="companyLecture"/);
  assert.match(admin, /id="companyFace"/);
  assert.match(admin, /id="saveCompanyServices"/);
  assert.equal(admin.indexOf('id="addChurch"') < admin.indexOf('id="addCompany"'), true);
  assert.match(adminJs, /newOrgWrites/);
  assert.match(adminJs, /serviceWrites/);
  assert.match(adminJs, /kind: "company"/);
  assert.match(admin, /id="saveAccount"/);
  assert.match(admin, /id="preachers"/);
  assert.match(admin, /id="gate"/);
  assert.match(admin, /id="adminApp" hidden/);
  assert.match(admin, /firebase-auth-compat/);
  assert.doesNotMatch(admin, /id="layout"|id="color"|id="fontRows"|id="saveStyle"|주보 사진/);
  assert.match(adminJs, /platformKeyRel/);
  assert.match(adminJs, /accounts:signUp|identity\.signUp|LI\.identity/);
  assert.doesNotMatch(adminJs, /createUserWithEmailAndPassword/);
  assert.match(authJs, /canClaimAdmin/);
  assert.match(authJs, /createUserWithEmailAndPassword/);
  assert.doesNotMatch(broadcast, /apiKey|API 키|sk-|id="model"|<select id="church"/);
  assert.match(broadcast, /id="churchEmail"/);
  assert.match(broadcast, /id="churchPassword"/);
  assert.match(broadcast, /id="layout"/);
  assert.match(broadcast, /id="color"/);
  assert.match(broadcast, /id="fontRows"/);
  assert.match(broadcast, /진행자료/);
  assert.match(broadcast, /강연자/);
  assert.match(broadcast, /큐시트/);
  assert.match(broadcast, /순서지/);
  assert.match(broadcast, /다른 교회는 고를 수 없습니다/);
  assert.doesNotMatch(renderer, /apiKey|listChurches|modelEl/);
  assert.match(renderer, /signIn/);
  assert.match(renderer, /saveStyle/);
  assert.match(renderer, /pickBulletin/);
  assert.match(renderer, /savePreacher/);
  assert.match(main, /getPlatformKey/);
  assert.doesNotMatch(listen, /type="password"|gateSubmit|signUp/);
  assert.doesNotMatch(overlay, /type="password"|gateSubmit|signUp/);
  assert.match(listen, /churchIsActive/);
  assert.match(overlay, /churchIsActive/);
  assert.match(readme, /두 가지 로그인/);
  assert.match(readme, /교회 계정/);
  assert.deepEqual(Object.keys(rules), ["live-interpret"]);
  const keyRule = rules["live-interpret"].platform.openaiKey[".read"];
  assert.match(keyRule, /admin\/uid/);
  assert.doesNotMatch(keyRule, /account\/uid/);
  assert.equal(keyRule === true || keyRule === "true", false);
  assert.match(church.preachers[".write"], /\$churchId/);
  assert.match(church.preachers[".write"], /account\/uid/);
  assert.match(church.sessions[".write"], /account\/uid/);
  assert.match(church.sessions.$folder.bulletin[".write"], /account\/uid/);
  assert.match(church.live.settings[".write"], /account\/uid/);
  assert.match(church.glossary[".write"], /admin\/uid/);
  assert.doesNotMatch(church.glossary[".write"], /account\/uid/);
  assert.match(church.model[".write"], /admin\/uid/);
  assert.doesNotMatch(church.model[".write"], /account\/uid/);
  assert.match(church.active[".write"], /admin\/uid/);
  assert.doesNotMatch(church.active[".write"], /account\/uid/);
  assert.equal(church[".write"], undefined);
  assert.doesNotMatch(JSON.stringify(rules), /cheil|jifc/);
  assert.equal(/sk-[A-Za-z0-9_-]{8,}/.test(readme), false);
  assert.equal(/sk-[A-Za-z0-9_-]{8,}/.test(admin), false);
  assert.equal(/sk-[A-Za-z0-9_-]{8,}/.test(broadcast), false);
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
  const orgServices = require("../docs/js/org-services.js");
  const companyWrites = orgServices.newOrgWrites({
    id: "acme-ab12",
    kind: "company",
    name: "에이씨엠이",
    uid: "uid-company",
    email: "ops@example.com",
    model: "gpt-4o-mini",
    settings: { targets: ["en"] },
    lecture: true,
    face: false,
    now: 10,
  });
  assert.equal(companyWrites["churches/acme-ab12/orgKind"], "company");
  assert.equal(companyWrites["churches/acme-ab12/services/lecture"].registered, true);
  assert.equal(companyWrites["churches/acme-ab12/services/face"].registered, false);
  const toggled = orgServices.serviceWrites({
    id: "acme-ab12",
    kind: "company",
    lecture: false,
    face: true,
    now: 20,
    previous: { lecture: companyWrites["churches/acme-ab12/services/lecture"] },
  });
  assert.equal(toggled.writes["churches/acme-ab12/orgKind"], "company");
  assert.equal(toggled.writes["churches/acme-ab12/services/lecture"].registered, false);
  assert.equal(toggled.writes["churches/acme-ab12/services/lecture"].registeredAt, 0);
  assert.equal(toggled.writes["churches/acme-ab12/services/face"].registered, true);
  assert.equal(toggled.writes["churches/acme-ab12/services/face"].registeredAt, 20);
  assert.equal(catalog.isPreacherId(catalog.makePreacherId("김 목사")), true);
  assert.equal(catalog.isModelId("gpt-4o-mini"), true);
  assert.equal(catalog.isModelId("other"), false);
  const context = catalog.sessionContextText({
    bulletin: { hymnNumbers: ["123"], songTitles: ["만복의 근원 하나님"], scripture: "요한복음 3:16", sermonTitle: "사랑", preacherName: "김목사" },
    preacher: { name: "김목사", traits: "천천히", corrections: "수여 → 수요", terms: "이른비" },
  });
  assert.match(context, /만복의 근원 하나님/);
  assert.match(context, /이른비/);
  const style = catalog.sanitizeStyle({ layout: "nope", color: "red", bgOpacity: 2, fonts: {} });
  assert.equal(style.global.layout, "bottom");
  assert.equal(style.global.color, "#ffffff");
  assert.equal(style.global.bgOpacity, 1);
});

test("firebase api key is not committed", () => {
  const root = path.join(__dirname, "..");
  const ignore = fs.readFileSync(path.join(root, ".gitignore"), "utf8");
  assert.match(ignore, /^\.env$/m);
  const example = fs.readFileSync(path.join(root, ".env.example"), "utf8");
  assert.match(example, /^FIREBASE_API_KEY=$/m);
  assert.match(example, /^DEPOSIT_HMAC_SECRET=$/m);
  assert.equal(/AIza[0-9A-Za-z\-_]{20,}/.test(example), false);
  const skip = new Set(["node_modules", ".git", "dist", "out"]);
  // 강연·회의, 대면, 전체 관리자 페이지는 브라우저 로그인에 이 파일 하나만 쓴다.
  const phoneKeyFile = path.join("docs", "js", "phone-firebase-env.js");
  const hits = [];
  let phoneKeySeen = false;
  function walk(dir) {
    for (const name of fs.readdirSync(dir)) {
      if (skip.has(name) || name === ".env") continue;
      const full = path.join(dir, name);
      const stat = fs.statSync(full);
      if (stat.isDirectory()) walk(full);
      else if (stat.isFile() && stat.size < 2_000_000) {
        const rel = path.relative(root, full);
        const text = fs.readFileSync(full);
        if (text.includes(0)) continue;
        if (!/AIza[0-9A-Za-z\-_]{20,}/.test(text.toString("utf8"))) continue;
        if (rel === phoneKeyFile) phoneKeySeen = true;
        else hits.push(rel);
      }
    }
  }
  walk(root);
  assert.equal(phoneKeySeen, true);
  const phoneKey = fs.readFileSync(path.join(root, phoneKeyFile), "utf8");
  assert.match(phoneKey, /FIREBASE_API_KEY/);
  assert.equal((phoneKey.match(/AIza[0-9A-Za-z\-_]{20,}/g) || []).length, 1);
  assert.equal(/AIza/.test(fs.readFileSync(path.join(root, "docs/js/runtime-env.js"), "utf8")), false);
  for (const page of ["docs/face/index.html", "docs/admin.html"]) {
    const html = fs.readFileSync(path.join(root, page), "utf8");
    const envAt = html.indexOf("phone-firebase-env.js");
    const catalogAt = html.indexOf("catalog.js");
    assert.equal(envAt > 0 && catalogAt > envAt, true);
  }
  const lecturePage = fs.readFileSync(path.join(root, "docs/lecture/index.html"), "utf8");
  assert.equal(lecturePage.includes("phone-firebase-env.js"), false);
  assert.equal(lecturePage.includes('type="password"'), false);
  assert.match(lecturePage, /id="joinId"/);
  assert.match(lecturePage, /id="name"/);
  assert.match(lecturePage, /id="spoken"/);
  assert.match(lecturePage, /for="joinId">암호</);
  assert.match(lecturePage, /for="name">이름</);
  assert.match(lecturePage, /for="spoken">말하는 언어</);
  assert.ok(lecturePage.indexOf('for="joinId"') < lecturePage.indexOf('for="name"'));
  assert.ok(lecturePage.indexOf('for="name"') < lecturePage.indexOf('for="spoken"'));
  assert.match(lecturePage, /lang\.flag/);
  assert.doesNotMatch(lecturePage, /spoken:\s*["']ko["']/);
  assert.doesNotMatch(lecturePage, /id="joinPin"|접속\s*번호|4자리|qrcode/);
  assert.equal(lecturePage.indexOf("languages.js") < lecturePage.indexOf("catalog.js"), true);
  assert.deepEqual(hits, []);
});

test("face session charges 2500 won per person hour and pauses the clock", () => {
  const orgServices = require("../docs/js/org-services.js");
  const cost = require("../docs/js/cost.js");
  assert.equal(cost.HOUR_BASE_KRW, 15000);
  assert.equal(cost.EXTRA_LANG_HOUR_KRW, 5000);
  assert.equal(orgServices.FACE_PERSON_KRW, 2500);
  assert.equal(orgServices.facePeopleKrw(1), 2500);
  assert.equal(orgServices.facePeopleKrw(2), 5000);
  assert.equal(orgServices.facePeopleKrw(3), 7500);
  const paid = orgServices.faceChargePatch({
    balance: 20000,
    people: 2,
    now: 1000,
    who: "host",
    churchId: "demo-ab12",
    note: "대면 통역",
  });
  assert.equal(paid.ok, true);
  assert.equal(paid.amount, 5000);
  assert.equal(paid.balance, 15000);
  assert.equal(paid.remainingSeconds, 3600);
  const three = orgServices.faceChargePatch({ balance: 7500, people: 3, now: 1000 });
  assert.equal(three.ok, true);
  assert.equal(three.amount, 7500);
  assert.equal(three.balance, 0);
  assert.equal(three.remainingSeconds, orgServices.FACE_BLOCK_SECONDS);
  const short = orgServices.faceChargePatch({ balance: 4000, people: 2, now: 1000 });
  assert.equal(short.ok, false);
  assert.equal(short.short, true);
  assert.equal(short.amount, 5000);
  assert.equal(orgServices.faceRemainingSeconds({ remainingSeconds: 100, paused: false, anchor: 1000 }, 61000), 40);
  assert.equal(orgServices.faceRemainingSeconds({ remainingSeconds: 100, paused: true, anchor: 1000 }, 61000), 100);
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
