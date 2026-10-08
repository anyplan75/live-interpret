const { parseJsonSafe } = require("./translator");
const sentence = require("./sentence");

const LIMITS = {
  traits: [12, 800],
  corrections: [40, 2000],
  terms: [40, 2000],
  pausePoints: [24, 1200],
  accuracy: [40, 2000],
  naturalness: [40, 2000],
};

const PAUSE_LINE = /^"([^"]{1,12})"\s*뒤\s*쉼(?:\s*(\d+)\s*회)?(?:\s*[—-]\s*(.*))?$/;

function textOf(value) {
  return String(value || "").replace(/\r/g, "").trim();
}

function linesOf(value) {
  return textOf(value).split("\n").map((line) => line.trim()).filter(Boolean);
}

function clip(lines, maxLines, maxChars) {
  let clipped = lines.slice(-maxLines);
  while (clipped.join("\n").length > maxChars && clipped.length > 1) clipped = clipped.slice(1);
  return clipped.join("\n");
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
  return clip(out, maxLines, maxChars);
}

function correctionKey(line) {
  const left = line.split(/\s*(?:→|->)\s*/)[0] || line;
  return left.replace(/["'“”‘’]/g, "").replace(/\s+/g, "").toLowerCase();
}

/** 같은 원문을 다시 고치면 새 교정이 옛 교정을 대신하고 맨 뒤(최신)로 갑니다. */
function mergeCorrections(current, extra, maxLines, maxChars) {
  const rows = new Map();
  [...linesOf(current), ...linesOf(extra)].forEach((line) => {
    const key = correctionKey(line);
    if (!key) return;
    rows.delete(key);
    rows.set(key, line);
  });
  return clip([...rows.values()], maxLines, maxChars);
}

function parsePauseLine(line) {
  const match = String(line || "").trim().match(PAUSE_LINE);
  if (!match) return null;
  return {
    tail: match[1].trim(),
    count: Math.max(1, Number(match[2]) || 1),
    example: textOf(match[3]),
  };
}

function formatPause(row) {
  const example = row.example ? ` — ${row.example}` : "";
  return `"${row.tail}" 뒤 쉼 ${row.count}회${example}`;
}

/** 꼬리별로 횟수를 더하고, 자주 끊는 위치부터 남깁니다. */
function mergePausePoints(current, extra, maxLines, maxChars) {
  const rows = new Map();
  [...linesOf(current), ...linesOf(extra)].forEach((line) => {
    const parsed = parsePauseLine(line);
    if (!parsed || !parsed.tail) return;
    const prev = rows.get(parsed.tail);
    rows.set(parsed.tail, {
      tail: parsed.tail,
      count: (prev ? prev.count : 0) + parsed.count,
      example: parsed.example || (prev ? prev.example : ""),
    });
  });
  const ranked = [...rows.values()].sort((a, b) => b.count - a.count).slice(0, maxLines);
  let lines = ranked.map(formatPause);
  while (lines.join("\n").length > maxChars && lines.length > 1) lines = lines.slice(0, -1);
  return lines.join("\n");
}

function pauseTails(profile) {
  return linesOf(profile && profile.pausePoints)
    .map(parsePauseLine)
    .filter((row) => row && row.tail && !sentence.endsSentence(row.tail))
    .map((row) => row.tail);
}

function normalizeProfile(raw, fallbackName) {
  const data = raw && typeof raw === "object" ? raw : {};
  const name = textOf(data.name || fallbackName);
  return {
    name,
    traits: textOf(data.traits),
    corrections: textOf(data.corrections),
    terms: textOf(data.terms),
    pausePoints: textOf(data.pausePoints),
    accuracy: textOf(data.accuracy),
    naturalness: textOf(data.naturalness),
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
    traits: mergeLines(base.traits, extra.traits, ...LIMITS.traits),
    corrections: mergeLines(base.corrections, extra.corrections, ...LIMITS.corrections),
    terms: mergeLines(base.terms, extra.terms, ...LIMITS.terms),
    pausePoints: mergePausePoints(base.pausePoints, extra.pausePoints, ...LIMITS.pausePoints),
    accuracy: mergeCorrections(base.accuracy, extra.accuracy, ...LIMITS.accuracy),
    naturalness: mergeCorrections(base.naturalness, extra.naturalness, ...LIMITS.naturalness),
    sermonCount: base.sermonCount + (extra.countSession ? 1 : 0),
    createdAt: base.createdAt,
    updatedAt: extra.updatedAt || Date.now(),
  };
}

function bare(value) {
  return String(value || "").replace(/[\s.,?!…·"'“”‘’]/g, "");
}

/** 문장 교정에서 실제로 바뀐 낱말만 뽑습니다. 예: "열반을 축복합니다" → "열방을 축복합니다" 이면 "열반을 → 열방을". */
function wordFix(heard, corrected) {
  const a = textOf(heard).split(/\s+/).filter(Boolean);
  const b = textOf(corrected).split(/\s+/).filter(Boolean);
  let start = 0;
  while (start < a.length && start < b.length && bare(a[start]) === bare(b[start])) start += 1;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && bare(a[endA - 1]) === bare(b[endB - 1])) {
    endA -= 1;
    endB -= 1;
  }
  const left = a.slice(start, endA).join(" ").replace(/[.,?!…]+$/g, "");
  const right = b.slice(start, endB).join(" ").replace(/[.,?!…]+$/g, "");
  if (!left || !right || bare(left) === bare(right)) return "";
  if (endA - start > 3 || endB - start > 3 || left.length > 24 || right.length > 24) return "";
  return `${left} → ${right}`;
}

function pausePointsFrom(pauses) {
  const rows = new Map();
  (pauses || []).forEach((pause) => {
    const tail = textOf(pause && pause.tail);
    const before = textOf(pause && pause.before);
    const after = textOf(pause && pause.after);
    if (!tail || tail.length > 12 || sentence.endsSentence(tail) || sentence.endsSentence(before)) return;
    const example = before && after ? `${before} / ${after}` : before;
    const prev = rows.get(tail);
    rows.set(tail, { tail, count: (prev ? prev.count : 0) + 1, example: example || (prev ? prev.example : "") });
  });
  return [...rows.values()]
    .filter((row) => row.count >= 2)
    .sort((a, b) => b.count - a.count)
    .slice(0, LIMITS.pausePoints[0])
    .map(formatPause)
    .join("\n");
}

function lessonFromLines(pairs, extra) {
  const corrections = [];
  const accuracy = [];
  (pairs || []).forEach((pair) => {
    const heard = textOf(pair && pair.heard);
    const corrected = textOf(pair && pair.corrected);
    if (!heard || !corrected || heard === corrected) return;
    corrections.push(`${heard} → ${corrected}`);
    const fix = wordFix(heard, corrected);
    if (fix) accuracy.push(fix);
  });
  const more = extra && typeof extra === "object" ? extra : {};
  return {
    corrections: corrections.slice(-20).join("\n"),
    terms: "",
    traits: "",
    pausePoints: pausePointsFrom(more.pauses),
    accuracy: [...new Set(accuracy)].slice(-20).join("\n"),
    naturalness: "",
    samples: Array.isArray(more.samples) ? more.samples.slice(-30) : [],
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

function samplesText(samples) {
  const lines = [];
  (samples || []).forEach((row) => {
    const ko = textOf(row && row.ko).replace(/\s+/g, " ");
    const out = textOf(row && row.text).replace(/\s+/g, " ");
    const lang = textOf(row && row.lang);
    if (!ko || !out || !lang) return;
    lines.push(`ko: ${ko}\n${lang}: ${out}`);
  });
  let text = lines.join("\n");
  while (text.length > 4000 && lines.length > 1) {
    lines.shift();
    text = lines.join("\n");
  }
  return text;
}

function rawLesson(lesson) {
  const { samples, ...rest } = lesson && typeof lesson === "object" ? lesson : {};
  return rest;
}

async function refineProfile(opts) {
  const lesson = rawLesson(opts.lesson);
  const merged = mergeProfile(opts.profile, lesson);
  if (!opts.apiKey || !opts.fetchImpl && typeof fetch === "undefined") return merged;
  const fetchImpl = opts.fetchImpl || fetch;
  const prompt = [
    "한국 교회 설교자의 인식·번역 프로필을 갱신하라.",
    "기존 프로필과 오늘 설교에서 고친 문장, 오늘 번역 예시를 보고 짧게 정리하라.",
    "traits: 말투. corrections: 한국어 인식 교정(잘못 들은 말 → 바른 말). terms: 이 설교자가 자주 쓰는 용어.",
    "accuracy: 번역을 더 정확하게 만드는 교정. 오역·용어 오류만. 형식은 한 줄에 하나, \"한국어 표현 → 바른 번역 (언어코드)\".",
    "naturalness: 번역을 더 자연스럽게 만드는 교정. 뜻은 맞지만 어색한 번역만. 형식은 한 줄에 하나, \"어색한 번역 → 자연스러운 번역 (언어코드)\".",
    "accuracy와 naturalness는 오늘 예시에서 새로 배운 것만 넣고, 확실하지 않으면 비워라.",
    "중복은 빼고, 오래된 항목보다 반복되는 항목을 남겨라. JSON만 반환하라.",
    '{"traits":"","corrections":"","terms":"","accuracy":"","naturalness":""}',
    `설교자: ${merged.name}`,
    `[기존 말투]\n${merged.traits}`,
    `[기존 교정]\n${merged.corrections}`,
    `[기존 용어]\n${merged.terms}`,
    `[말 끊는 위치]\n${merged.pausePoints}`,
    `[기존 정확도 교정]\n${merged.accuracy}`,
    `[기존 자연스러움 교정]\n${merged.naturalness}`,
    `[오늘 배운 교정]\n${textOf(lesson.corrections)}`,
    `[오늘 번역 예시]\n${samplesText(opts.lesson && opts.lesson.samples)}`,
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
    const join = (key) => [textOf(lesson[key]), textOf(parsed[key])].filter(Boolean).join("\n");
    return mergeProfile(opts.profile, {
      name: lesson.name,
      traits: join("traits"),
      corrections: join("corrections"),
      terms: join("terms"),
      pausePoints: textOf(lesson.pausePoints),
      accuracy: join("accuracy"),
      naturalness: join("naturalness"),
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
  pauseTails,
  wordFix,
};
