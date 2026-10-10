const functions = require("firebase-functions");
const admin = require("firebase-admin");
const { verifySignature, applyToDatabase } = require("./ledger");

if (!admin.apps.length) admin.initializeApp();

exports.deposit = functions.https.onRequest(async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "POST만 받습니다." });
    return;
  }
  const secret = process.env.DEPOSIT_HMAC_SECRET || "";
  if (!req.rawBody || !req.rawBody.length) {
    res.status(400).json({ ok: false, error: "본문이 없습니다." });
    return;
  }
  if (!verifySignature(secret, req.rawBody, req.get("X-Deposit-Signature") || "")) {
    res.status(401).json({ ok: false, error: "서명이 올바르지 않습니다." });
    return;
  }
  let body;
  try {
    body = JSON.parse(req.rawBody.toString("utf8"));
  } catch (_) {
    res.status(400).json({ ok: false, error: "JSON이 올바르지 않습니다." });
    return;
  }
  if (!body || typeof body !== "object" || !Number.isFinite(Number(body.amountKrw)) || Number(body.amountKrw) <= 0) {
    res.status(400).json({ ok: false, error: "입금 내용이 올바르지 않습니다." });
    return;
  }
  try {
    const result = await applyToDatabase(admin.database(), body);
    res.status(200).json(result);
  } catch (err) {
    const status = err && err.status ? err.status : 500;
    res.status(status).json({ ok: false, error: err && err.message ? err.message : "입금 처리에 실패했습니다." });
  }
});
