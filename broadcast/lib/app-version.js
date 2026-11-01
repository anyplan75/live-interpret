"use strict";

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

/**
 * 앱 버전(마케팅)과 빌드 번호를 헷갈리지 않게 한 줄로 만듭니다.
 * 예: "앱 버전 0.1.0 · 빌드 0.1.51"
 */
function formatVersionLine(version, build, opts) {
  const ver = String(version || "").trim() || "?";
  const bld = String(build || "").trim() || "?";
  const packaged = opts && opts.packaged === true;
  if (!packaged) {
    return `앱 버전 ${ver} · 빌드 개발`;
  }
  if (bld === ver) {
    return `앱 버전 ${ver} · 빌드 ${bld}`;
  }
  return `앱 버전 ${ver} · 빌드 ${bld}`;
}

function readPlistBuddy(infoPath, key) {
  try {
    return execFileSync("/usr/libexec/PlistBuddy", ["-c", `Print :${key}`, infoPath], {
      encoding: "utf8",
    }).trim();
  } catch (_) {
    return "";
  }
}

/**
 * 설치본 Info.plist에서 앱 버전·빌드 번호를 읽습니다.
 * 개발 실행이면 package.json 버전과 "개발" 표시용 값을 돌립니다.
 */
function readAppVersionInfo(appLike) {
  const packaged = !!(appLike && appLike.isPackaged);
  const marketing = String((appLike && appLike.getVersion && appLike.getVersion()) || "").trim() || "?";
  if (!packaged || process.platform !== "darwin") {
    return {
      version: marketing,
      build: packaged ? marketing : "개발",
      packaged,
      line: formatVersionLine(marketing, packaged ? marketing : "개발", { packaged }),
    };
  }

  let infoPath = "";
  try {
    const exe = typeof process.execPath === "string" ? process.execPath : "";
    if (exe) infoPath = path.join(path.dirname(exe), "..", "Info.plist");
  } catch (_) {
    infoPath = "";
  }

  let version = marketing;
  let build = marketing;
  if (infoPath && fs.existsSync(infoPath)) {
    const short = readPlistBuddy(infoPath, "CFBundleShortVersionString");
    const bundle = readPlistBuddy(infoPath, "CFBundleVersion");
    if (short) version = short;
    if (bundle) build = bundle;
  }

  return {
    version,
    build,
    packaged: true,
    line: formatVersionLine(version, build, { packaged: true }),
  };
}

module.exports = {
  formatVersionLine,
  readAppVersionInfo,
};
