const cost = require("./cost");

/**
 * 방송 중 요금 계수기.
 * 음성 초와 언어별 글자 수만 쌓습니다. 문장과 음성은 보관하지 않습니다.
 */
class UsageMeter {
  constructor() {
    this.audioSeconds = 0;
    this.chars = {};
    this.startedAt = 0;
    this.clockOn = false;
    this.languages = [];
  }

  start(languages, at) {
    this.startedAt = at == null ? Date.now() : at;
    this.clockOn = true;
    this.setLanguages(languages);
  }

  minutesAt(now) {
    if (!this.clockOn) return 0;
    const at = typeof now === "number" ? now : Date.now();
    return Math.max(0, (at - this.startedAt) / 60000);
  }

  setLanguages(languages) {
    this.languages = Array.isArray(languages) ? languages.slice() : [];
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
    const at = typeof now === "number" ? now : Date.now();
    const minutes = this.minutesAt(at);
    return cost.usageRecord({
      audioSeconds: this.audioSeconds,
      chars: this.chars,
      model,
      minutes,
      languages: this.languages,
    }, at);
  }
}

async function persistUsage(db, churchId, folder, record) {
  const safe = cost.usageRecord(record, record && record.updatedAt);
  await db.set(`churches/${churchId}/live/usage`, safe);
  if (folder) await db.set(`churches/${churchId}/sessions/${folder}/usage`, safe);
  return safe;
}

module.exports = { UsageMeter, persistUsage };
