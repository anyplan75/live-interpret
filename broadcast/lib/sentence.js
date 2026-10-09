/**
 * 한국어 설교 문장 절단.
 * cheil 송출기와 같은 종결어미·조사 꼬리·침묵 flush 기준을 유지합니다.
 */
const ENDINGS =
  "축원합니다|축원하옵나이다|하옵나이다|하겠습니다|하셨습니다|하십니다|바랍니다|할지어다|하시옵소서|하여\\s*주옵소서|주옵소서|하옵소서|주시옵소서|나이다|이옵니다|아닙니까|습니까|합니까|인가요|은가요|는가요|잖아요|아닙니다|것입니다|겁니다|입니다|습니다|합니다|합시다|하십시다|십시오|세요|시죠|아멘|네요|어요|아요|예요|대요|지요|군요|죠|느냐|도다|입니까";

const ENDING = new RegExp(`(${ENDINGS})(\\s|[.,?!]|$)`, "g");

const ENDS_SENTENCE = new RegExp(`(?:${ENDINGS})$`);

const CLAUSE = /(는데|지만|면서|니까|어서|아서|으니|도록|하며)(\s)/g;

const HANGING_TAIL =
  /(이|가|을|를|은|는|의|에|로|와|과|도|만|께|께서|에서|으로|라고|으며|면서|는데|지만|으니|아서|어서|하며|하고|며|고|제|내|그|저|또|및|좀|더|참|정말|우리|나의|그의|주님|하나님|예수|성령)$/;

const NOISE = /^(네+|예+|음+|어+|아+|으+|그+|저+|응+|오+|어\s*어+|아\s*아+)$/;

function stripTrailing(text) {
  return String(text || "").replace(/[\s.,?!…·"'”’)\]]+$/g, "").trim();
}

function endsSentence(text) {
  const t = stripTrailing(text);
  if (!t) return false;
  return ENDS_SENTENCE.test(t);
}

function lastWord(text) {
  const words = stripTrailing(text).split(/\s+/).filter(Boolean);
  return words.length ? words[words.length - 1] : "";
}

function firstWord(text) {
  const words = String(text || "").replace(/^[\s.,?!…·"'“‘(\[]+/g, "").split(/\s+/).filter(Boolean);
  return words.length ? words[0].replace(/[.,?!…]+$/g, "") : "";
}

function pauseTail(text) {
  const word = lastWord(text);
  if (!word) return "";
  const hanging = word.match(HANGING_TAIL);
  if (hanging) return hanging[0];
  return word.length <= 3 ? word : word.slice(-2);
}

function isHangingTail(text) {
  const t = String(text || "").trim();
  if (!t) return false;
  return HANGING_TAIL.test(t);
}

function isNoise(text) {
  const t = String(text || "").trim();
  if (!t) return true;
  if (t.length < 2) return true;
  if (NOISE.test(t)) return true;
  if (/^[ㄱ-ㅎㅏ-ㅣ\s]+$/.test(t)) return true;
  if (/^([가-힣])\1{2,}$/.test(t)) return true;
  return false;
}

function findLastEnding(text, minIndex) {
  ENDING.lastIndex = 0;
  let best = null;
  let execResult;
  while ((execResult = ENDING.exec(text)) !== null) {
    if (execResult.index >= minIndex) best = execResult;
  }
  return best;
}

function findClauseCut(text) {
  CLAUSE.lastIndex = 0;
  let best = null;
  let execResult;
  while ((execResult = CLAUSE.exec(text)) !== null) {
    if (execResult.index >= 40 && execResult.index <= text.length - 24) best = execResult;
  }
  return best;
}

function findCutMatch(text) {
  if (!text || text.length < 12) return null;
  const minIdx = 10;
  if (text.length < 100) {
    ENDING.lastIndex = 0;
    let execResult;
    while ((execResult = ENDING.exec(text)) !== null) {
      if (execResult.index >= minIdx) {
        const cutAt = execResult.index + execResult[0].length;
        const piece = text.slice(0, cutAt).trim();
        if (!isHangingTail(piece) && !isNoise(piece)) return execResult;
      }
    }
  } else {
    const last = findLastEnding(text, minIdx);
    if (last) {
      const cutAt = last.index + last[0].length;
      const piece = text.slice(0, cutAt).trim();
      const rest = text.slice(cutAt).trim();
      if (!isHangingTail(piece) && !isNoise(piece)) {
        if (rest.length === 0 || rest.length >= 12 || text.length >= 140) return last;
      }
    }
  }

  if (text.length >= 120) {
    const clause = findClauseCut(text);
    if (clause) {
      const cutAt = clause.index + clause[0].length;
      const piece = text.slice(0, cutAt).trim();
      if (piece.length >= 40 && !isHangingTail(piece)) return clause;
    }
  }

  if (text.length >= 150) {
    const windowEnd = Math.min(text.length - 20, 140);
    let idx = text.lastIndexOf(" ", windowEnd);
    while (idx > 40) {
      const piece = text.slice(0, idx).trim();
      if (!isHangingTail(piece) && piece.length >= 40) {
        return { index: idx, 0: " ", length: 1 };
      }
      idx = text.lastIndexOf(" ", idx - 1);
    }
  }
  return null;
}

/** 번역을 시작할 목표 길이입니다. 이 글자 수 자체에서 자르지 않고, 그 근처의 경계에서 끊습니다. */
const TRANSLATE_MAX = 140;
/** 목표 길이의 앞뒤로 이만큼까지 자연스러운 경계를 찾습니다. */
const TRANSLATE_WINDOW = 40;
const SENTENCE_STOP = /[.?!。！？]+[…"'”’)\]]*(?=\s|$|[^\d.?!。！？…"'”’)\]])/g;
const COMMA = /[,，](?=\s|$)/g;

function nearTarget(end, target) {
  return end >= target - TRANSLATE_WINDOW && end <= target + TRANSLATE_WINDOW;
}

function closestTo(ends, target) {
  let best = 0;
  let bestDist = Infinity;
  for (const end of ends) {
    const dist = Math.abs(end - target);
    if (dist < bestDist || (dist === bestDist && end < best)) {
      best = end;
      bestDist = dist;
    }
  }
  return best;
}

/**
 * 목표 길이를 넘긴 말에서 번역으로 넘길 앞부분의 끝 위치입니다. 아직 짧으면 0.
 * 140자 근처(앞뒤 40자)에서 문장 끝, 연결 어미, 쉼표, 띄어쓰기 순으로 고르고,
 * 같은 종류에서는 140에 가장 가까운 곳을 씁니다. 단어 한가운데는 자르지 않습니다.
 */
function translateBreak(text, maxLen = TRANSLATE_MAX) {
  const t = String(text || "");
  if (t.trim().length <= maxLen) return 0;
  const sentences = [];
  const clauses = [];
  const commas = [];
  const spaces = [];
  let match;
  SENTENCE_STOP.lastIndex = 0;
  while ((match = SENTENCE_STOP.exec(t)) !== null) {
    const end = match.index + match[0].length;
    if (end === t.length && match[0][0] === "." && /\d$/.test(t.slice(0, match.index))) continue;
    if (!t.slice(0, match.index).trim()) continue;
    if (nearTarget(end, maxLen)) sentences.push(end);
  }
  ENDING.lastIndex = 0;
  while ((match = ENDING.exec(t)) !== null) {
    if (match.index < 10) continue;
    const end = match.index + match[0].length;
    const piece = t.slice(0, end).trim();
    if (!piece || isHangingTail(piece) || isNoise(piece)) continue;
    if (nearTarget(end, maxLen)) sentences.push(end);
  }
  const sentenceAt = closestTo(sentences, maxLen);
  if (sentenceAt) return sentenceAt;

  CLAUSE.lastIndex = 0;
  while ((match = CLAUSE.exec(t)) !== null) {
    const end = match.index + match[0].length;
    if (!t.slice(0, match.index).trim()) continue;
    if (nearTarget(end, maxLen)) clauses.push(end);
  }
  const clauseAt = closestTo(clauses, maxLen);
  if (clauseAt) return clauseAt;

  COMMA.lastIndex = 0;
  while ((match = COMMA.exec(t)) !== null) {
    const end = match.index + match[0].length;
    if (!t.slice(0, match.index).trim()) continue;
    if (nearTarget(end, maxLen)) commas.push(end);
  }
  const commaAt = closestTo(commas, maxLen);
  if (commaAt) return commaAt;

  for (let i = 1; i < t.length; i += 1) {
    if (t[i] === " ") spaces.push(i);
  }
  const nearSpaces = spaces.filter((end) => nearTarget(end, maxLen));
  return closestTo(nearSpaces.length ? nearSpaces : spaces, maxLen);
}

function canSilenceFlush(text, silenceMs, cfg) {
  const t = String(text || "").trim();
  if (!t || isNoise(t)) return false;
  const minChars = (cfg && cfg.minFlushChars) || 8;
  const soft = (cfg && cfg.silenceFlushMs) || 3200;
  const hard = (cfg && cfg.silenceForceFlushMs) || 6500;
  if (silenceMs < soft) return false;
  if (silenceMs >= hard) return true;
  if (t.length < minChars) return false;
  if (isHangingTail(t)) return false;
  return true;
}

module.exports = {
  findCutMatch,
  isHangingTail,
  isNoise,
  canSilenceFlush,
  endsSentence,
  stripTrailing,
  lastWord,
  firstWord,
  pauseTail,
  translateBreak,
  TRANSLATE_MAX,
  TRANSLATE_WINDOW,
};
