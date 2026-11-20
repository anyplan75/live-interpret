/**
 * 로컬 ProPresenter 브릿지.
 * 방송실 PC에서만 듣고, 확정된 우리 프로토콜만 받습니다.
 *
 * POST /slide  JSON: { "type": "slide", "text": "...", "at"?: number }
 * GET  /health
 *
 * 포트: LIVE_INTERPRET_PP_BRIDGE_PORT (숫자, 없으면 브릿지 끔)
 * 기본 바인딩: 127.0.0.1 만 (외부 노출 금지)
 */

const http = require("http");
const { readEnv } = require("./client");

function cleanPort(value) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n) || n < 1 || n > 65535) return 0;
  return n;
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > 200000) {
        reject(new Error("본문이 너무 큽니다."));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

function createLocalBridge(opts) {
  const options = opts && typeof opts === "object" ? opts : {};
  const port = cleanPort(options.port != null ? options.port : readEnv("LIVE_INTERPRET_PP_BRIDGE_PORT"));
  const host = String(options.host || "127.0.0.1");
  const onSlide = typeof options.onSlide === "function" ? options.onSlide : () => {};
  const onLog = typeof options.onLog === "function" ? options.onLog : () => {};
  let server = null;
  let listening = false;

  function snapshot() {
    return {
      enabled: port > 0,
      listening,
      host,
      port: port || 0,
    };
  }

  function handleSlide(payload) {
    const src = payload && typeof payload === "object" ? payload : {};
    const text = String(src.text || src.body || "").trim();
    if (!text) return { ok: false, error: "text 가 비었습니다." };
    const at = Number(src.at) || Date.now();
    onSlide({ text, at, type: "slide", source: "bridge" });
    return { ok: true };
  }

  async function start() {
    if (!port) {
      onLog("PP 로컬 브릿지: 포트 없음(LIVE_INTERPRET_PP_BRIDGE_PORT). 비활성.");
      return snapshot();
    }
    if (server) return snapshot();
    server = http.createServer(async (req, res) => {
      const url = String(req.url || "").split("?")[0];
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      try {
        if (req.method === "GET" && (url === "/" || url === "/health")) {
          res.statusCode = 200;
          res.end(JSON.stringify({ ok: true, service: "live-interpret-pp-bridge" }));
          return;
        }
        if (req.method === "POST" && (url === "/slide" || url === "/pp/slide")) {
          const body = await parseBody(req);
          const result = handleSlide(body);
          res.statusCode = result.ok ? 200 : 400;
          res.end(JSON.stringify(result));
          return;
        }
        res.statusCode = 404;
        res.end(JSON.stringify({ ok: false, error: "not found" }));
      } catch (err) {
        res.statusCode = 400;
        res.end(JSON.stringify({ ok: false, error: String(err && err.message || err) }));
      }
    });
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, host, () => {
        listening = true;
        onLog(`PP 로컬 브릿지: ${host}:${port}`);
        resolve();
      });
    });
    return snapshot();
  }

  async function stop() {
    if (!server) {
      listening = false;
      return snapshot();
    }
    const current = server;
    server = null;
    await new Promise((resolve) => {
      current.close(() => resolve());
    });
    listening = false;
    return snapshot();
  }

  /** 테스트·목업용: HTTP 없이 같은 경로로 슬라이드를 넣습니다. */
  function inject(payload) {
    return handleSlide(payload);
  }

  return { start, stop, inject, snapshot };
}

module.exports = { createLocalBridge, cleanPort };
