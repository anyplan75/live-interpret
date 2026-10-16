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
    return { text: one.text, id: one.id, isFinal: one.isFinal };
  }
  const lines = {};
  entries.forEach((line) => {
    lines[line.channelKey] = {
      text: line.text,
      id: line.id,
      isFinal: line.isFinal,
      name: line.name,
    };
  });
  const latest = entries[entries.length - 1];
  return {
    text: latest.text,
    id: latest.id,
    isFinal: latest.isFinal,
    name: latest.name,
    lines,
  };
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
        if (!text) bucket.delete(channelKey);
        else {
          bucket.set(channelKey, {
            channelKey,
            text,
            id: row.id,
            isFinal: row.isFinal !== false,
            name: String(row.name || "").trim(),
          });
        }
        out[lang] = publishLang(bucket);
      });
      return out;
    },
  };
}

module.exports = { createSubtitleBoard, safeKey };
