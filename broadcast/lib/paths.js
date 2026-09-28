const path = require("path");
const { langByCode } = require("./catalog");

function safeChurchName(name) {
  let cleaned = String(name || "")
    .replace(/[\\/:*?"<>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  if (!cleaned || cleaned === "." || cleaned === "..") cleaned = "church";
  return cleaned;
}

function sessionFolderName(date) {
  const pad = (n) => String(n).padStart(2, "0");
  const when = date instanceof Date ? date : new Date();
  return `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}_${pad(when.getHours())}-${pad(when.getMinutes())}-${pad(when.getSeconds())}`;
}

function isSessionFolder(name) {
  return /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}$/.test(String(name || ""));
}

function sessionDir(root, churchName, folderName) {
  if (!root) throw new Error("저장 폴더가 없습니다.");
  if (!isSessionFolder(folderName)) throw new Error("세션 폴더 이름이 올바르지 않습니다.");
  const safe = safeChurchName(churchName);
  const base = path.resolve(root);
  const dir = path.resolve(base, safe, folderName);
  if (dir !== base && !dir.startsWith(base + path.sep)) {
    throw new Error("저장 경로가 선택한 폴더 밖으로 나갑니다.");
  }
  return dir;
}

function langFile(dir, lang) {
  if (!langByCode[lang]) throw new Error("지원하지 않는 언어입니다.");
  const file = path.resolve(dir, `${lang}.txt`);
  if (path.dirname(file) !== path.resolve(dir)) throw new Error("언어 파일 경로가 올바르지 않습니다.");
  return file;
}

module.exports = {
  safeChurchName,
  sessionFolderName,
  isSessionFolder,
  sessionDir,
  langFile,
};
