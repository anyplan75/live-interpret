/**
 * 운영 계정 화면.
 * 비밀번호는 여기 두지 않는다.
 * 운영 계정은 로그인한 주소가 anyplan@me.com 이고, 서버에 저장된 관리자 uid와 같을 때만 연다.
 */
const cost = require("./cost");

const OPERATOR_EMAIL = "anyplan@me.com";

function isOperatorEmail(email) {
  return typeof email === "string" && email.trim().toLowerCase() === OPERATOR_EMAIL;
}

function isOperatorAccount(session, adminUid) {
  if (!session || !isOperatorEmail(session.email)) return false;
  if (typeof adminUid !== "string" || !adminUid) return false;
  return session.localId === adminUid;
}

function stamp(at) {
  const when = new Date(at);
  const pad = (n) => String(n).padStart(2, "0");
  return `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())} ${pad(when.getHours())}:${pad(when.getMinutes())}`;
}

function latestSession(sessionIndex) {
  if (!sessionIndex || typeof sessionIndex !== "object") return null;
  let picked = null;
  Object.values(sessionIndex).forEach((row) => {
    if (!row || typeof row !== "object") return;
    const at = Math.max(Math.round(Number(row.endedAt) || 0), Math.round(Number(row.startedAt) || 0));
    if (!at) return;
    if (!picked || at > picked.at) {
      picked = {
        at,
        audioSeconds: Math.max(0, Math.round(Number(row.audioSeconds) || 0)),
        churchKrw: Math.round(Number(row.churchKrw) || 0),
      };
    }
  });
  return picked;
}

function recentUse(usage, sessionIndex) {
  const liveAt = usage && typeof usage === "object" ? Math.round(Number(usage.updatedAt) || 0) : 0;
  const live = liveAt ? {
    at: liveAt,
    audioSeconds: Math.max(0, Math.round(Number(usage.audioSeconds) || 0)),
    churchKrw: Math.round(Number(usage.churchKrw) || 0),
  } : null;
  const saved = latestSession(sessionIndex);
  const picked = !live ? saved : !saved ? live : (live.at >= saved.at ? live : saved);
  if (!picked) return "최근 사용 없음";
  const parts = [stamp(picked.at)];
  if (picked.audioSeconds > 0) parts.push(cost.formatClock(picked.audioSeconds));
  if (picked.churchKrw) parts.push(cost.formatKrw(picked.churchKrw));
  return parts.join(" · ");
}

function accountRow(id, indexRow, billing, usage, sessionIndex) {
  const name = indexRow && typeof indexRow.name === "string" && indexRow.name.trim()
    ? indexRow.name.trim()
    : id;
  const balanceKrw = Math.round(Number(billing && billing.balance) || 0);
  const prepaid = cost.normalizePrepaid(billing && billing.prepaid);
  const remainingSeconds = prepaid ? prepaid.remainingSeconds : 0;
  return {
    id,
    name,
    balanceKrw,
    remainingSeconds,
    balanceLabel: cost.formatKrw(balanceKrw),
    timeLabel: remainingSeconds > 0 ? cost.prepaidLabel(remainingSeconds) : "남은 시간 없음",
    recentLabel: recentUse(usage, sessionIndex),
  };
}

function creditUpdate(input) {
  const source = input || {};
  const credit = cost.applyCredit({
    balance: source.balance,
    amount: source.amount,
    churchId: source.accountId,
    who: source.who || "",
    note: "선불 잔액",
    at: source.now,
    type: "manual",
  });
  if (!credit.ok) return { ok: false, balance: Math.round(Number(source.balance) || 0), patch: null };
  const row = { ...credit.entry };
  delete row.id;
  return {
    ok: true,
    balance: credit.balance,
    balanceLabel: cost.formatKrw(credit.balance),
    patch: {
      balance: credit.balance,
      lastEntryId: credit.entry.id,
      [`ledger/${credit.entry.id}`]: row,
    },
  };
}

module.exports = {
  OPERATOR_EMAIL,
  isOperatorEmail,
  isOperatorAccount,
  accountRow,
  creditUpdate,
  recentUse,
};
