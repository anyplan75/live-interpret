/**
 * 대면 통역의 한 마디. 인식과 번역은 방송 앱과 같은 OpenAI 주소를 씁니다.
 * 키는 인자로만 받고, 오류 문장에 남기지 않습니다.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.LI = root.LI || {};
  root.LI.speechTurn = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  function safeError(message) {
    return String(message || "요청에 실패했습니다.")
      .replace(/sk-[A-Za-z0-9_\-]+/g, "[key]")
      .replace(/Bearer\s+\S+/gi, "Bearer [key]");
  }

  function wavBytes(pcm, sampleRate) {
    const samples = pcm && pcm.length ? pcm : new Int16Array(0);
    const bytes = samples.length * 2;
    const rate = sampleRate || 24000;
    const out = new Uint8Array(44 + bytes);
    const view = new DataView(out.buffer);
    out.set([82, 73, 70, 70], 0);
    view.setUint32(4, 36 + bytes, true);
    out.set([87, 65, 86, 69, 102, 109, 116, 32], 8);
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, rate, true);
    view.setUint32(28, rate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    out.set([100, 97, 116, 97], 36);
    view.setUint32(40, bytes, true);
    for (let i = 0; i < samples.length; i += 1) view.setInt16(44 + i * 2, samples[i], true);
    return out;
  }

  async function readJson(res) {
    try {
      return await res.json();
    } catch (_) {
      return {};
    }
  }

  async function transcribePcm(pcm, opts) {
    const source = opts || {};
    if (!source.apiKey) throw new Error("번역 키가 없습니다.");
    const fetchImpl = source.fetchImpl || fetch;
    const wav = wavBytes(pcm, source.sampleRate || 24000);
    const language = source.transcriptionLanguage || source.language || "ko";
    const models = ["gpt-4o-mini-transcribe", "whisper-1"];
    let last = null;
    for (const model of models) {
      const form = new FormData();
      form.append("file", new Blob([wav], { type: "audio/wav" }), "speech.wav");
      form.append("model", model);
      form.append("language", language);
      const res = await fetchImpl("https://api.openai.com/v1/audio/transcriptions", {
        method: "POST",
        headers: { Authorization: `Bearer ${source.apiKey}` },
        body: form,
      });
      const data = await readJson(res);
      if (!res.ok) {
        last = new Error(safeError((data.error && data.error.message) || `음성 인식 ${res.status}`));
        if (res.status === 404 || /model/i.test(last.message)) continue;
        throw last;
      }
      return String(data.text || "").trim();
    }
    throw last || new Error("음성 인식에 실패했습니다.");
  }

  async function translateLine(text, opts) {
    const source = opts || {};
    const line = String(text || "").trim();
    const from = String(source.sourceLang || "ko");
    const to = String(source.targetLang || "en");
    if (!line) return "";
    if (from === to) return line;
    if (!source.apiKey) throw new Error("번역 키가 없습니다.");
    const fetchImpl = source.fetchImpl || fetch;
    const model = source.model || "gpt-4o-mini";
    const res = await fetchImpl("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${source.apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.15,
        messages: [{
          role: "user",
          content: `너는 실시간 통역자다. 원문은 ${from}다. ${to}로만 자연스럽게 번역하라. 요약하거나 설명을 붙이지 마라. 번역문만 출력하라.\n\n${line}`,
        }],
      }),
    });
    const data = await readJson(res);
    if (!res.ok || data.error) {
      throw new Error(safeError((data.error && data.error.message) || `번역 요청 실패 (${res.status})`));
    }
    const content = data.choices && data.choices[0] && data.choices[0].message
      ? data.choices[0].message.content
      : "";
    return String(content || "").trim();
  }

  return { wavBytes, safeError, transcribePcm, translateLine };
});
