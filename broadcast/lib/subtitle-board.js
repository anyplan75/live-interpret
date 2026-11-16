function safeKey(value) {
  const clean = String(value || "main").replace(/[^A-Za-z0-9_-]/g, "");
  return clean.slice(0, 64) || "main";
}

function publishLang(bucket) {
  const entries = [...bucket.values()];
  if (!entries.length) return { text: "", id: 0, isFinal: true };
  const named = entries.some((line) => line.name);
  const multi = entries.length > 1;
  if (!named && !multi) {
    const one = entries[0];
    return withAt({ text: one.text, id: one.id, isFinal: one.isFinal }, one.at);
  }
  const lines = {};
  entries.forEach((line) => {
    lines[line.channelKey] = withAt({
      text: line.text,
      id: line.id,
      isFinal: line.isFinal,
      name: line.name,
    }, line.at);
  });
  const latest = entries.reduce((best, line) => ((line.at || 0) >= (best.at || 0) ? line : best), entries[0]);
  return withAt({
    text: latest.text,
    id: latest.id,
    isFinal: latest.isFinal,
    name: latest.name,
    lines,
  }, latest.at);
}

function withAt(row, at) {
  if (at) row.at = at;
  return row;
}

function createSubtitleBoard() {
  const langs = new Map();
  let seq = 0;
  return {
    merge(payload) {
      const source = payload && typeof payload === "object" ? payload : {};
      seq = (seq + 1) % 1000;
      const out = { _timestamp: Date.now() * 1000 + seq };
      Object.entries(source).forEach(([lang, row]) => {
        if (lang === "_timestamp" || !row || typeof row !== "object" || Array.isArray(row)) return;
        if (!langs.has(lang)) langs.set(lang, new Map());
        const bucket = langs.get(lang);
        const channelKey = safeKey(row.channelKey || "main");
        const text = String(row.text || "").trim();
        const prev = bucket.get(channelKey);
        // 늦게 온 듣는 중 자막이 같은 문장의 확정 자막을 덮지 않게 합니다.
        const stale = row.isFinal === false && prev && prev.isFinal && prev.id === row.id;
        if (stale) {
          /* 확정 자막을 그대로 둡니다 */
        } else if (!text) bucket.delete(channelKey);
        else {
          bucket.set(channelKey, {
            channelKey,
            text,
            id: row.id,
            isFinal: row.isFinal !== false,
            name: String(row.name || "").trim(),
            at: Number(row.at) || 0,
          });
        }
        out[lang] = publishLang(bucket);
      });
      return out;
    },
  };
}

/**
 * 자막 쓰기를 한 번에 하나씩 순서대로 보냅니다. 앞 쓰기가 끝나기 전에 온 것은 하나로 합쳐 보냅니다.
 * 늦게 출발한 쓰기가 먼저 도착해 최신 자막을 덮는 일을 막습니다.
 */
function createSubtitleSender(write) {
  let queued = null;
  let waiters = [];
  let busy = false;
  async function pump() {
    busy = true;
    while (queued) {
      const body = queued;
      const done = waiters;
      queued = null;
      waiters = [];
      try {
        await write(body);
        done.forEach((waiter) => waiter.resolve());
      } catch (err) {
        done.forEach((waiter) => waiter.reject(err));
      }
    }
    busy = false;
  }
  return function send(body) {
    queued = queued ? { ...queued, ...body } : { ...body };
    const result = new Promise((resolve, reject) => waiters.push({ resolve, reject }));
    if (!busy) pump();
    return result;
  };
}

module.exports = { createSubtitleBoard, createSubtitleSender, safeKey };
