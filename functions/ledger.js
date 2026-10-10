const crypto = require("crypto");

function signBody(secret, raw) {
  const body = Buffer.isBuffer(raw) ? raw : Buffer.from(String(raw), "utf8");
  return crypto.createHmac("sha256", String(secret || "")).update(body).digest("hex");
}

function verifySignature(secret, raw, header) {
  if (!secret || header == null || raw == null || raw === "") return false;
  const expected = signBody(secret, raw);
  const given = String(header).trim().toLowerCase().replace(/^sha256=/, "");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(given, "utf8");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function sanitizeDepositId(id) {
  return String(id || "").replace(/[.#$[\]/]/g, "_").slice(0, 128);
}

function validChurchId(id) {
  return /^[\p{L}\p{N}_-]{1,64}$/u.test(String(id || ""));
}

function ledgerId(now) {
  const stamp = now == null ? Date.now() : now;
  return `e${stamp}_${Math.random().toString(36).slice(2, 8)}`;
}

function applyCredit(input) {
  const source = input || {};
  const credit = Math.round(Number(source.amount) || 0);
  const current = Math.round(Number(source.balance) || 0);
  if (credit <= 0) return { ok: false, balance: current };
  const next = current + credit;
  const at = source.at == null ? Date.now() : source.at;
  const entry = {
    id: source.id || ledgerId(at),
    type: "deposit",
    deltaKrw: credit,
    amountKrw: credit,
    balanceAfter: next,
    at,
    who: "webhook",
    note: "입금",
    depositId: source.depositId || "",
    churchId: source.churchId || "",
  };
  return { ok: true, balance: next, entry };
}

function billingState(state) {
  const current = state && typeof state === "object" ? state : {};
  return {
    balances: { ...(current.balances || {}) },
    deposits: { ...(current.deposits || {}) },
    ledger: Array.isArray(current.ledger) ? current.ledger.slice() : [],
  };
}

function prepareDeposit(state, body) {
  const source = body || {};
  const depositId = sanitizeDepositId(source.depositId);
  const churchId = String(source.churchId || "").trim();
  const amount = Math.round(Number(source.amountKrw) || 0);
  const snapshot = billingState(state);
  if (!depositId || !churchId || amount <= 0) {
    return { ok: false, duplicate: false, balance: Math.round(Number(snapshot.balances[churchId]) || 0), state: snapshot };
  }
  if (snapshot.deposits[depositId]) {
    return {
      ok: true,
      duplicate: true,
      balance: Math.round(Number(snapshot.balances[churchId]) || 0),
      state: snapshot,
    };
  }
  const credit = applyCredit({
    balance: snapshot.balances[churchId] || 0,
    amount,
    churchId,
    depositId,
    at: source.paidAt == null ? Date.now() : source.paidAt,
  });
  snapshot.balances[churchId] = credit.balance;
  snapshot.deposits[depositId] = { churchId, amountKrw: amount, at: credit.entry.at };
  snapshot.ledger.push(credit.entry);
  return { ok: true, duplicate: false, balance: credit.balance, entry: credit.entry, state: snapshot };
}

async function applyToDatabase(db, body) {
  const source = body || {};
  const depositId = sanitizeDepositId(source.depositId);
  const churchId = String(source.churchId || "").trim();
  const amount = Math.round(Number(source.amountKrw) || 0);
  if (!depositId || !validChurchId(churchId) || amount <= 0) {
    const err = new Error("입금 내용이 올바르지 않습니다.");
    err.status = 400;
    throw err;
  }
  const marker = db.ref(`live-interpret/deposits/${depositId}`);
  const tx = await marker.transaction((current) => {
    if (current) return;
    return {
      churchId,
      amountKrw: amount,
      paidAt: source.paidAt == null ? Date.now() : source.paidAt,
    };
  });
  const balanceRef = db.ref(`live-interpret/churches/${churchId}/billing/balance`);
  if (!tx.committed) {
    const existing = tx.snapshot && tx.snapshot.val();
    if (!existing) throw new Error("입금 표시를 저장하지 못했습니다.");
    const snap = await balanceRef.get();
    return { ok: true, duplicate: true, balance: Math.round(Number(snap.val()) || 0) };
  }
  const snap = await balanceRef.get();
  const credit = applyCredit({
    balance: snap.val(),
    amount,
    churchId,
    depositId,
    at: source.paidAt == null ? Date.now() : source.paidAt,
  });
  const row = { ...credit.entry };
  delete row.id;
  try {
    await db.ref(`live-interpret/churches/${churchId}/billing`).update({
      balance: credit.balance,
      lastEntryId: credit.entry.id,
      [`ledger/${credit.entry.id}`]: row,
    });
  } catch (err) {
    err.depositMarked = true;
    throw err;
  }
  return { ok: true, duplicate: false, balance: credit.balance };
}

module.exports = {
  signBody,
  verifySignature,
  sanitizeDepositId,
  validChurchId,
  prepareDeposit,
  applyToDatabase,
};
