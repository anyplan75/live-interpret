/**
 * cheil과 같은 교정·번역.
 * 예배 문맥 교정, 교회 용어집, 5개 언어 배치, JSON 실패 시 1회 재시도.
 */
const { langByCode, defaultModel } = require("./catalog");

const BATCH_SIZE = 5;

function buildPrompt(koreanText, targetCodes, opts) {
  const langLines = ["ko: 교정된 한국어", ...targetCodes.map((code) => {
    const meta = langByCode[code];
    return `${code}: ${meta ? meta.name : code} 번역`;
  })];
  const schemaKeys = ["ko", ...targetCodes].map((code) => `  "${code}": "..."`).join(",\n");
  const contextBlock = opts.previousContext ? `\n[직전 문맥]\n${opts.previousContext}\n` : "";
  const sessionContext = String(opts.sessionContext || "").trim();
  const sessionBlock = sessionContext ? `\n[이번 예배·설교자]\n${sessionContext}\n` : "";
  const glossary = String(opts.glossary || "").trim();
  const koMode = opts.koFixed
    ? "한국어(ko)는 이미 교정된 문장이다. 의미 변경 없이 그대로 ko에 넣고, 지정 언어만 번역하라."
    : `1) 한국어 STT 오인식·오탈자·띄어쓰기를 예배/설교 문맥에 맞게 교정하라.
2) 분명한 오인식(교회명·예배 용어·성경 표현·찬송 가사)은 고치고, 불확실하면 원문에 가깝게 유지하라.
3) 내용을 요약·삭제·임의 첨삭하지 마라. 미완성 연결어미로 끝나면 억지로 종결하지 마라.
4) 의미 없는 추임새만 있는 입력이면 ko에 빈 문자열 ""을 넣어라.`;

  return `너는 한국 교회 예배(설교·기도·찬송·광고) 동시통역·자막 교정기다.
${koMode}
5) 지정 언어로 자연스럽고 예배에 어울리게 번역하라.
6) JSON 문자열 값 안의 따옴표는 반드시 이스케이프하라.

${glossary}
${sessionBlock}
${contextBlock}
반드시 아래 JSON 형식으로만 응답 (키: ${langLines.join(", ")}):
{
${schemaKeys}
}

발화 원본: ${JSON.stringify(koreanText)}`;
}

function parseJsonSafe(content) {
  if (!content || typeof content !== "string") throw new Error("빈 응답");
  try {
    return JSON.parse(content);
  } catch (_) {
    /* 코드펜스나 앞뒤 설명이 붙은 응답 */
  }
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(content.slice(start, end + 1));
    } catch (_) {
      /* 재시도로 넘긴다 */
    }
  }
  throw new Error("JSON 파싱 실패");
}

async function callOnce(koreanText, targetCodes, opts) {
  const fetchImpl = opts.fetchImpl || fetch;
  const response = await fetchImpl("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${opts.apiKey}`,
    },
    body: JSON.stringify({
      model: opts.model,
      messages: [{ role: "user", content: buildPrompt(koreanText, targetCodes, opts) }],
      response_format: { type: "json_object" },
      temperature: 0.15,
    }),
    signal: AbortSignal.timeout(45000),
  });
  const data = await response.json();
  if (!response.ok || data.error) {
    throw new Error((data.error && data.error.message) || `번역 요청 실패 (${response.status})`);
  }
  const content = data.choices && data.choices[0] && data.choices[0].message
    ? data.choices[0].message.content
    : "";
  return parseJsonSafe(content);
}

async function callWithRetry(koreanText, targetCodes, opts) {
  try {
    return await callOnce(koreanText, targetCodes, opts);
  } catch (_) {
    await new Promise((resolve) => setTimeout(resolve, opts.retryDelayMs == null ? 400 : opts.retryDelayMs));
    return callOnce(koreanText, targetCodes, opts);
  }
}

async function translate(koreanText, opts) {
  const apiKey = opts.apiKey;
  if (!apiKey) throw new Error("OpenAI API 키가 없습니다.");
  const model = opts.model || defaultModel;
  const targetCodes = (opts.targetCodes && opts.targetCodes.length ? opts.targetCodes : [])
    .filter((code) => code !== "ko" && langByCode[code]);
  const baseOpts = {
    apiKey,
    model,
    previousContext: opts.previousContext || "",
    sessionContext: opts.sessionContext || "",
    glossary: opts.glossary || "",
    koFixed: false,
    fetchImpl: opts.fetchImpl,
    retryDelayMs: opts.retryDelayMs,
  };

  const firstBatch = targetCodes.slice(0, BATCH_SIZE);
  const first = await callWithRetry(koreanText, firstBatch, baseOpts);
  const correctedKo = first.ko != null && String(first.ko).trim()
    ? String(first.ko).trim()
    : koreanText;
  const result = { ...first, ko: correctedKo };

  for (let i = BATCH_SIZE; i < targetCodes.length; i += BATCH_SIZE) {
    const batch = targetCodes.slice(i, i + BATCH_SIZE);
    try {
      const part = await callWithRetry(correctedKo, batch, { ...baseOpts, koFixed: true });
      batch.forEach((code) => {
        if (part[code]) result[code] = part[code];
      });
    } catch (err) {
      if (opts.onBatchError) opts.onBatchError(batch, err);
    }
  }

  if (!result.ko) result.ko = koreanText;
  return result;
}

module.exports = {
  translate,
  buildPrompt,
  parseJsonSafe,
  BATCH_SIZE,
};
