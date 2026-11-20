/**
 * ProPresenter 7 연동 클라이언트.
 *
 * 네이티브 HTTP/WebSocket 경로·메시지 형식은 아직 확정되지 않았습니다.
 * 환경변수 값이 있어도 추측 경로로 붙지 않고, 상태를 unconfigured / todo 로 둡니다.
 *
 * 환경변수 이름(값·비밀은 코드에 적지 않음):
 * - LIVE_INTERPRET_PP_HTTP_URL  — ProPresenter HTTP 베이스(미확정)
 * - LIVE_INTERPRET_PP_WS_URL    — ProPresenter WebSocket(미확정)
 *
 * 실제 슬라이드 수신은 로컬 브릿지(`bridge.js`)가 담당합니다.
 */

function readEnv(name) {
  try {
    return String(process.env[name] || "").trim();
  } catch (_) {
    return "";
  }
}

function createProPresenterClient(opts) {
  const options = opts && typeof opts === "object" ? opts : {};
  const httpUrl = String(options.httpUrl || readEnv("LIVE_INTERPRET_PP_HTTP_URL") || "").trim();
  const wsUrl = String(options.wsUrl || readEnv("LIVE_INTERPRET_PP_WS_URL") || "").trim();
  let status = "idle";
  let detail = "";

  function snapshot() {
    return {
      status,
      detail,
      httpConfigured: !!httpUrl,
      wsConfigured: !!wsUrl,
      // TODO: ProPresenter 7 공식/실측 API 경로가 확정되면 여기에 연결합니다.
      // 지금은 URL만 있어도 추측 엔드포인트로 요청하지 않습니다.
      nativeApi: "todo",
    };
  }

  async function start() {
    if (!httpUrl && !wsUrl) {
      status = "unconfigured";
      detail = "LIVE_INTERPRET_PP_HTTP_URL / LIVE_INTERPRET_PP_WS_URL 미설정. 로컬 브릿지·목업만 사용.";
      return snapshot();
    }
    status = "todo";
    detail = "ProPresenter 네이티브 엔드포인트가 확정되지 않아 연결하지 않습니다. 로컬 브릿지를 쓰세요.";
    return snapshot();
  }

  async function stop() {
    status = "idle";
    detail = "";
    return snapshot();
  }

  return { start, stop, snapshot };
}

module.exports = { createProPresenterClient, readEnv };
