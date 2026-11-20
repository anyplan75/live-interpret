/**
 * ProPresenter 슬라이드 목업 이벤트 발생기.
 * 실제 ProPresenter 없이 우선순위·정규화·브릿지를 시험할 때 씁니다.
 */

const DEFAULT_SLIDES = [
  "[Verse 1]\n주님을 찬양합니다\n그 크신 사랑",
  "[Chorus]\n할렐루야  할렐루야\n영원히 찬양하리",
  "오늘 본문은 요한복음 3장 16절입니다",
  "[Bridge]\n은혜로  sufficed", // 의도적 잡음·공백
];

function createMockSlideGenerator(opts) {
  const options = opts && typeof opts === "object" ? opts : {};
  const slides = Array.isArray(options.slides) && options.slides.length
    ? options.slides.map((row) => String(row || ""))
    : DEFAULT_SLIDES.slice();
  const intervalMs = Math.max(200, Math.round(Number(options.intervalMs) || 1200));
  const onSlide = typeof options.onSlide === "function" ? options.onSlide : () => {};
  let timer = null;
  let index = 0;
  let running = false;

  function emitOne() {
    const text = slides[index % slides.length];
    index += 1;
    onSlide({ type: "slide", text, at: Date.now(), source: "mock", index });
  }

  function start() {
    if (running) return { running: true, count: slides.length };
    running = true;
    index = 0;
    emitOne();
    timer = setInterval(emitOne, intervalMs);
    return { running: true, count: slides.length };
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
    running = false;
    return { running: false, count: slides.length };
  }

  function once(text) {
    onSlide({ type: "slide", text: text != null ? String(text) : slides[0], at: Date.now(), source: "mock" });
  }

  return { start, stop, once, slides: () => slides.slice() };
}

module.exports = { createMockSlideGenerator, DEFAULT_SLIDES };
