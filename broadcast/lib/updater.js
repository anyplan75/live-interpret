const { redactSecrets } = require("./catalog");
const pkg = require("../../package.json");

const RELEASES_URL = "https://github.com/anyplan75/live-interpret/releases";

/**
 * Squirrel.Mac은 Apple Developer ID로 서명한 앱만 스스로 교체합니다.
 * 서명 전에는 맥에서 새 버전을 알리기만 하고, 서명 뒤 package.json 의 liveInterpret.macSilentUpdate 를 true 로 바꿉니다.
 */
function silentUpdateAllowed(platform, config) {
  if (platform !== "darwin") return true;
  return Boolean(config && config.macSilentUpdate);
}

function startAutoUpdate(opts) {
  const app = opts.app;
  const log = opts.log || (() => {});
  const platform = opts.platform || process.platform;
  if (!app || !app.isPackaged) return null;
  let updater;
  try {
    updater = opts.updater || require("electron-updater").autoUpdater;
  } catch (err) {
    log("error", `자동 업데이트를 불러오지 못했습니다: ${redactSecrets(err.message || String(err))}`);
    return null;
  }
  const silent = silentUpdateAllowed(platform, opts.config || pkg.liveInterpret);
  updater.autoDownload = silent;
  updater.autoInstallOnAppQuit = silent;
  updater.allowPrerelease = false;
  updater.on("update-available", (info) => {
    const version = info && info.version ? info.version : "";
    log("info", silent
      ? `새 버전 ${version}을 내려받습니다.`
      : `새 버전 ${version}이 있습니다. 맥은 아직 자동 설치가 되지 않습니다. ${RELEASES_URL} 에서 내려받아 주세요.`);
  });
  updater.on("update-downloaded", (info) => {
    const version = info && info.version ? info.version : "";
    log("info", `새 버전 ${version}을 받았습니다. 앱을 끄면 설치되고 다음 실행부터 적용됩니다.`);
  });
  updater.on("error", (err) => {
    log("error", `업데이트 확인 실패: ${redactSecrets((err && err.message) || String(err))}`);
  });
  // electron-updater는 실패를 "error" 이벤트로도 보내므로 여기서 다시 적지 않습니다.
  Promise.resolve()
    .then(() => updater.checkForUpdates())
    .catch(() => {});
  return updater;
}

module.exports = { startAutoUpdate, silentUpdateAllowed, RELEASES_URL };
