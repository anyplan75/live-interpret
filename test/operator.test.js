const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const operator = require("../broadcast/lib/operator");

const root = path.join(__dirname, "..");

test("only the named account is the operator, and no password is stored", () => {
  const source = fs.readFileSync(path.join(root, "broadcast/lib/operator.js"), "utf8");
  assert.equal(operator.isOperatorEmail(" anyplan@me.com "), true);
  assert.equal(operator.isOperatorEmail("ANYPLAN@ME.COM"), true);
  assert.equal(operator.isOperatorEmail("other@me.com"), false);
  assert.equal(operator.isOperatorAccount({ email: "anyplan@me.com", localId: "uid-1" }, "uid-1"), true);
  assert.equal(operator.isOperatorAccount({ email: "anyplan@me.com", localId: "uid-2" }, "uid-1"), false);
  assert.equal(operator.isOperatorAccount({ email: "other@me.com", localId: "uid-1" }, "uid-1"), false);
  assert.equal(operator.isOperatorAccount({ email: "anyplan@me.com", localId: "uid-1" }, ""), false);
  assert.doesNotMatch(source, /password|비밀번호\s*[:=]/);
});

test("one screen lists name, balance, time, and recent use", () => {
  const row = operator.accountRow("alpha", { name: "한빛" }, {
    balance: 30000,
    prepaid: {
      remainingSeconds: 3200,
      languageKey: "ko,en",
      kind: "hour",
      amountKrw: 15000,
      extraCount: 0,
      updatedAt: 10,
    },
  }, {
    audioSeconds: 600,
    churchKrw: 15000,
    updatedAt: Date.UTC(2026, 9, 22, 0, 30),
  }, {
    old: { startedAt: 1, endedAt: 2, churchKrw: 1000 },
  });
  assert.equal(row.name, "한빛");
  assert.equal(row.balanceKrw, 30000);
  assert.equal(row.balanceLabel, "30,000원");
  assert.equal(row.remainingSeconds, 3200);
  assert.match(row.timeLabel, /남은 시간/);
  assert.match(row.recentLabel, /15,000원/);
  assert.doesNotMatch(JSON.stringify(row), /교회|apiKrw/);
  const unused = operator.accountRow("beta", { name: "둘째" }, { balance: 0 }, null, null);
  assert.equal(unused.timeLabel, "남은 시간 없음");
  assert.equal(unused.recentLabel, "최근 사용 없음");
});

test("adding prepaid credit increases only that account balance", () => {
  const denied = operator.creditUpdate({ balance: 1000, amount: 0, accountId: "alpha", who: "uid-1" });
  assert.equal(denied.ok, false);
  const added = operator.creditUpdate({
    balance: 1000,
    amount: 15000,
    accountId: "alpha",
    who: "uid-1",
    now: 50,
  });
  assert.equal(added.ok, true);
  assert.equal(added.balance, 16000);
  assert.equal(added.patch.balance, 16000);
  const entryId = added.patch.lastEntryId;
  const row = added.patch[`ledger/${entryId}`];
  assert.equal(row.deltaKrw, 15000);
  assert.equal(row.balanceAfter, 16000);
  assert.equal(row.type, "manual");
  assert.equal(row.note, "선불 잔액");
  assert.equal(row.churchId, "alpha");
  assert.equal(row.text, undefined);
});

test("server rules let only the operator read every account and add credit", () => {
  const rules = JSON.parse(fs.readFileSync(path.join(root, "firebase/live-interpret.rules.json"), "utf8"));
  const live = rules["live-interpret"];
  const email = "auth.token.email.toLowerCase() === 'anyplan@me.com'";
  assert.match(live.churchIndex[".read"], new RegExp(email.replace(/[().]/g, "\\$&")));
  assert.match(live.churches.$churchId[".read"], new RegExp(email.replace(/[().]/g, "\\$&")));
  const balance = live.churches.$churchId.billing.balance[".validate"];
  assert.match(balance, /auth\.token\.email\.toLowerCase\(\) === 'anyplan@me\.com'/);
  assert.match(balance, /newData\.val\(\) < data\.val\(\)/);
  assert.match(balance, /deltaKrw'\)\.val\(\) > 0/);
  assert.match(live.churches.$churchId.billing.balance[".write"], /account\/uid/);
  const html = fs.readFileSync(path.join(root, "broadcast/renderer/index.html"), "utf8");
  const page = html.slice(html.indexOf('id="operator"'), html.indexOf('id="heardSection"'));
  assert.match(page, /hidden/);
  assert.match(page, /계정 사용/);
  assert.match(page, /남은 잔액/);
  assert.match(page, /최근 사용/);
  assert.match(page, /id="operatorCredit"/);
  assert.doesNotMatch(page, /교회/);
  const actions = html.slice(html.indexOf('id="broadcastActions"'), html.indexOf('id="costCard"'));
  assert.match(actions, /id="start">시작</);
  assert.match(html, /id="confirmStart">시작확인</);
  const main = fs.readFileSync(path.join(root, "broadcast/main.js"), "utf8");
  const listHandler = main.slice(main.indexOf('ipcMain.handle("operator:list"'), main.indexOf('ipcMain.handle("operator:credit"'));
  assert.match(listHandler, /operatorGate/);
  const creditHandler = main.slice(main.indexOf('ipcMain.handle("operator:credit"'), main.indexOf('ipcMain.handle("church:current"'));
  assert.match(creditHandler, /operatorGate/);
  assert.match(creditHandler, /충전할 금액을 적으세요/);
  assert.match(main, /isOperatorAccount/);
  const renderer = fs.readFileSync(path.join(root, "broadcast/renderer/renderer.js"), "utf8");
  const creditClick = renderer.slice(renderer.indexOf('getElementById("operatorCredit")'), renderer.indexOf('getElementById("pickBulletin").addEventListener'));
  assert.match(creditClick, /충전할 금액을 적으세요/);
  assert.match(renderer, /visibleError/);
  const { userText } = require("../broadcast/lib/user-text");
  assert.equal(userText("Error invoking remote method 'operator:credit': Error: 충전할 금액을 적으세요"), "충전할 금액을 적으세요");
  assert.equal(userText("Error: 계정을 골라 주세요.\n    at processTicksAndRejections (node:internal/process:1:1)"), "계정을 골라 주세요.");
  assert.equal(userText(""), "다시 시도해 주세요.");
});
