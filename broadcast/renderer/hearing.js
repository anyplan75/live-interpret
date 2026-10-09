(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Hearing = api;
})(typeof self !== "undefined" ? self : this, function () {
  const IDLE = "대기 중...";

  /**
   * 노란 칸에는 지금 듣는 발화만, 아래에는 끝난 발화를 "듣는 말"로 쌓습니다.
   * 한 번 쌓인 듣는 말은 지우거나 고치지 않고, "교정"은 그 듣는 말 바로 아래에만 붙습니다.
   */
  function createHearing(doc, liveEl, stackEl) {
    const blocks = new Map();
    let fallback = 0;

    function line(className, label, text) {
      const p = doc.createElement("p");
      p.className = className;
      const tag = doc.createElement("span");
      tag.className = "tag";
      tag.textContent = label;
      p.append(tag, doc.createTextNode(text));
      return p;
    }

    function follow(update) {
      const atBottom = stackEl.scrollHeight - stackEl.scrollTop - stackEl.clientHeight < 24;
      update();
      if (atBottom) stackEl.scrollTop = stackEl.scrollHeight;
    }

    function live(text) {
      const value = String(text || "").trim();
      liveEl.textContent = value || IDLE;
    }

    function heard(id, text) {
      const value = String(text || "").trim();
      if (!value) return null;
      const key = String(id);
      if (blocks.has(key)) return blocks.get(key);
      const block = doc.createElement("article");
      block.className = "ko-line";
      block.dataset.heard = key;
      block.append(line("heard", "듣는 말", value));
      follow(() => stackEl.append(block));
      blocks.set(key, block);
      return block;
    }

    function corrected(heardId, raw, text) {
      const value = String(text || "").trim();
      if (!value) return null;
      let block = heardId != null && heardId !== "" ? blocks.get(String(heardId)) : null;
      if (!block) {
        fallback += 1;
        block = heard(`raw-${fallback}`, raw);
      }
      if (!block) return null;
      const p = line("corrected", "교정", value);
      follow(() => block.append(p));
      return p;
    }

    function reset() {
      blocks.clear();
      fallback = 0;
      stackEl.replaceChildren();
      live("");
    }

    return { live, heard, corrected, reset };
  }

  return { createHearing, IDLE };
});
