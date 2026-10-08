// 패키지된 Electron은 Node fetch가 인증서 저장소에 닿지 못해
// TypeError: fetch failed 로 끝난다. 앱 안에서는 Chromium 네트워크를 쓴다.
async function netFetch(url, options) {
  const impl = process.versions.electron ? require("electron").net.fetch : fetch;
  try {
    return await impl(url, options);
  } catch (err) {
    const cause = err && err.cause;
    const detail = cause ? (cause.message || cause.code || "") : "";
    const message = err && err.message ? err.message : String(err);
    if (detail && !message.includes(detail)) throw new Error(`${message}: ${detail}`);
    throw new Error(message);
  }
}

module.exports = { netFetch };
