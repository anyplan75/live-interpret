const cost = require("./cost");

/**
 * 방송 중 요금 계수기.
 * 음성 초와 언어별 글자 수만 쌓습니다. 문장과 음성은 보관하지 않습니다.
 */
class UsageMeter {
  constructor() {
    this.audioSeconds = 0;
    this.chars = {};
  }

  addPcm16(byteLength, sampleRate) {
    this.audioSeconds += cost.audioSecondsFromPcm(byteLength, sampleRate || 24000);
  }

  addTranslation(text, langs) {
    const count = String(text || "").length;
    if (!count || !langs) return;
    langs.forEach((lang) => {
      if (!lang || lang === "ko") return;
      this.chars[lang] = (this.chars[lang] || 0) + count;
    });
  }

  record(model, now) {
    return cost.usageRecord({
      audioSeconds: this.audioSeconds,
      chars: this.chars,
      model,
    }, now);
  }
}

async function persistUsage(db, churchId, folder, record) {
  const safe = cost.usageRecord(record, record && record.updatedAt);
  await db.set(`churches/${churchId}/live/usage`, safe);
  if (folder) await db.set(`churches/${churchId}/sessions/${folder}/usage`, safe);
  return safe;
}

module.exports = { UsageMeter, persistUsage };
