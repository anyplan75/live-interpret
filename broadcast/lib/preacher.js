const { parseJsonSafe } = require("./translator");

function textOf(value) {
  return String(value || "").replace(/\r/g, "").trim();
}

function linesOf(value) {
  return textOf(value).split("\n").map((line) => line.trim()).filter(Boolean);
}

function mergeLines(current, extra, maxLines, maxChars) {
  const seen = new Set();
  const out = [];
  [...linesOf(current), ...linesOf(extra)].forEach((line) => {
    const key = line.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(line);
  });
  let clipped = out.slice(-maxLines);
  while (clipped.join("\n").length > maxChars && clipped.length > 1) clipped = clipped.slice(1);
  return clipped.join("\n");
}

function normalizeProfile(raw, fallbackName) {
  const data = raw && typeof raw === "object" ? raw : {};
  const name = textOf(data.name || fallbackName);
  return {
    name,
    traits: textOf(data.traits),
    corrections: textOf(data.corrections),
    terms: textOf(data.terms),
    sermonCount: Number.isFinite(Number(data.sermonCount)) ? Number(data.sermonCount) : 0,
    createdAt: Number(data.createdAt) || Date.now(),
    updatedAt: Number(data.updatedAt) || Date.now(),
  };
}

function mergeProfile(profile, lesson) {
  const base = normalizeProfile(profile);
  const extra = lesson && typeof lesson === "object" ? lesson : {};
  const name = textOf(extra.name || base.name);
  return {
    name,
    traits: mergeLines(base.traits, extra.traits, 12, 800),
    corrections: mergeLines(base.corrections, extra.corrections, 40, 2000),
    terms: mergeLines(base.terms, extra.terms, 40, 2000),
    sermonCount: base.sermonCount + (extra.countSession ? 1 : 0),
    createdAt: base.createdAt,
    updatedAt: extra.updatedAt || Date.now(),
  };
}

function lessonFromLines(pairs) {
  const corrections = [];
  (pairs || []).forEach((pair) => {
    const heard = textOf(pair && pair.heard);
    const corrected = textOf(pair && pair.corrected);
    if (!heard || !corrected || heard === corrected) return;
    corrections.push(`${heard} → ${corrected}`);
  });
  return {
    corrections: corrections.slice(-20).join("\n"),
    terms: "",
    traits: "",
    countSession: true,
  };
}

function matchPreacher(preachers, name) {
  const norm = (value) => textOf(value).replace(/\s+/g, "").toLowerCase();
  const target = norm(name);
  if (!target) return null;
  return (preachers || []).find((preacher) => {
    const current = norm(preacher && preacher.name);
    if (!current) return false;
    return current === target || current.includes(target) || target.includes(current);
  }) || null;
}

async function refineProfile(opts) {
  const merged = mergeProfile(opts.profile, opts.lesson);
  if (!opts.apiKey || !opts.fetchImpl && typeof fetch === "undefined") return merged;
  const fetchImpl = opts.fetchImpl || fetch;
  const prompt = [
    "한국 교회 설교자의 인식 프로필을 갱신하라.",
    "기존 프로필과 오늘 설교에서 고친 문장을 반영해 말투, 교정, 용어를 짧게 유지하라.",
    "중복은 빼고, 오래된 항목보다 반복되는 항목을 남겨라. JSON만 반환하라.",
    '{"traits":"","corrections":"","terms":""}',
    `설교자: ${merged.name}`,
    `[기존 말투]\n${merged.traits}`,
    `[기존 교정]\n${merged.corrections}`,
    `[기존 용어]\n${merged.terms}`,
    `[오늘 배운 교정]\n${textOf(opts.lesson && opts.lesson.corrections)}`,
  ].join("\n");
  try {
    const response = await fetchImpl("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${opts.apiKey}`,
      },
      body: JSON.stringify({
        model: opts.model || "gpt-4o-mini",
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [{ role: "user", content: prompt }],
      }),
      signal: AbortSignal.timeout(45000),
    });
    const data = await response.json();
    if (!response.ok || data.error) return merged;
    const content = data.choices && data.choices[0] && data.choices[0].message
      ? data.choices[0].message.content
      : "";
    const parsed = parseJsonSafe(content);
    const lesson = opts.lesson || {};
    return mergeProfile(opts.profile, {
      name: lesson.name,
      traits: [textOf(lesson.traits), textOf(parsed.traits)].filter(Boolean).join("\n"),
      corrections: [textOf(lesson.corrections), textOf(parsed.corrections)].filter(Boolean).join("\n"),
      terms: [textOf(lesson.terms), textOf(parsed.terms)].filter(Boolean).join("\n"),
      countSession: true,
    });
  } catch (_) {
    return merged;
  }
}

module.exports = {
  normalizeProfile,
  mergeProfile,
  lessonFromLines,
  matchPreacher,
  refineProfile,
};
