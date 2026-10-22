/**
 * 맥 앱스토어 울타리(sandbox)는 문서 폴더에 그냥 폴더를 만들지 못한다.
 * 사용자가 고른 폴더와, 맥이 주는 출입표(security-scoped bookmark)가 있을 때만 연다.
 * 출입표는 비밀 열쇠가 아니다. 이 컴퓨터의 설정 파일에만 둔다.
 */
const fs = require("fs");
const path = require("path");

let held = null;

function releaseFolder() {
  if (!held) return;
  const stop = held.release;
  held = null;
  if (typeof stop === "function") {
    try { stop(); } catch (_) { /* 이미 닫힌 출입표는 넘어갑니다 */ }
  }
}

function canCreateChild(root) {
  const probe = path.join(root, `.live-interpret-write-test-${process.pid}`);
  try {
    const stat = fs.statSync(root);
    if (!stat.isDirectory()) return false;
    fs.rmSync(probe, { recursive: true, force: true });
    fs.mkdirSync(probe);
    fs.rmSync(probe, { recursive: true, force: true });
    return true;
  } catch (_) {
    try { fs.rmSync(probe, { recursive: true, force: true }); } catch (__) { /* 시험 폴더가 없으면 지울 것이 없습니다 */ }
    return false;
  }
}

/**
 * 고른 폴더에 세션 폴더를 만들 수 있으면 true.
 * 앱스토어 빌드에서는 출입표를 연 뒤에만 검사한다.
 * 같은 폴더를 다시 검사할 때는 출입표를 중복으로 열지 않는다.
 */
function useFolder(options) {
  const source = options && typeof options === "object" ? options : {};
  const folder = String(source.folder || "").trim();
  const bookmark = String(source.bookmark || "");
  const mas = source.mas === true;
  if (!folder) {
    releaseFolder();
    return false;
  }
  if (held && held.folder === folder && held.bookmark === bookmark && held.mas === mas) {
    if (canCreateChild(folder)) return true;
    releaseFolder();
    return false;
  }
  releaseFolder();
  let release = () => {};
  if (mas) {
    if (!bookmark || typeof source.startAccess !== "function") return false;
    try {
      const stop = source.startAccess(bookmark);
      if (typeof stop !== "function") return false;
      release = stop;
    } catch (_) {
      return false;
    }
  }
  if (!canCreateChild(folder)) {
    try { release(); } catch (_) { /* 열지 못한 폴더는 출입표도 닫습니다 */ }
    return false;
  }
  held = { folder, bookmark, mas, release };
  return true;
}

module.exports = { useFolder, releaseFolder, canCreateChild };
