#!/usr/bin/env node
/**
 * ProPresenter 슬라이드 목업.
 * 로컬 브릿지(LIVE_INTERPRET_PP_BRIDGE_PORT)로 POST /slide 를 보냅니다.
 *
 * 사용:
 *   LIVE_INTERPRET_PP_BRIDGE_PORT=8765 node scripts/mock-pp-slides.js
 *   node scripts/mock-pp-slides.js --port 8765 --once "테스트 슬라이드"
 */

const http = require("http");
const { DEFAULT_SLIDES } = require("../broadcast/lib/propresenter/mock");

function argValue(flag, fallback) {
  const idx = process.argv.indexOf(flag);
  if (idx < 0 || idx + 1 >= process.argv.length) return fallback;
  return process.argv[idx + 1];
}

function hasFlag(flag) {
  return process.argv.includes(flag);
}

const port = Math.round(Number(argValue("--port", process.env.LIVE_INTERPRET_PP_BRIDGE_PORT || 0)) || 0);
const once = argValue("--once", "");
const intervalMs = Math.max(300, Math.round(Number(argValue("--interval", "1500")) || 1500));

if (!port) {
  console.error("포트를 주세요. 예: --port 8765 또는 LIVE_INTERPRET_PP_BRIDGE_PORT");
  process.exit(1);
}

function postSlide(text) {
  const body = JSON.stringify({ type: "slide", text: String(text || ""), at: Date.now() });
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: "127.0.0.1",
      port,
      path: "/slide",
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Length": Buffer.byteLength(body),
      },
    }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString("utf8") });
      });
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

async function main() {
  if (once || hasFlag("--once")) {
    const text = once || "목업 슬라이드";
    const result = await postSlide(text);
    console.log(result.status, result.body);
    return;
  }
  let i = 0;
  console.log(`목업 → 127.0.0.1:${port}/slide 간격 ${intervalMs}ms`);
  const tick = async () => {
    const text = DEFAULT_SLIDES[i % DEFAULT_SLIDES.length];
    i += 1;
    try {
      const result = await postSlide(text);
      console.log(`#${i}`, result.status, String(text).slice(0, 40).replace(/\s+/g, " "));
    } catch (err) {
      console.error("전송 실패:", err.message || err);
    }
  };
  await tick();
  setInterval(tick, intervalMs);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
