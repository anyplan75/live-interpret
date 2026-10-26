/**
 * 방송실에서 설정 앱을 열 때 넘기는 로그인 폴더.
 * 암호는 담지 않고, 이 맥의 앱 자료 폴더만 받습니다.
 */
const fs = require("fs");
const path = require("path");

function rawSessionDir(argv, env) {
  const args = Array.isArray(argv) ? argv : [];
  const hit = args.find((item) => typeof item === "string" && item.startsWith("--session-dir="));
  if (hit) return hit.slice("--session-dir=".length).trim();
  const fromEnv = env && env.LIVE_INTERPRET_SESSION_DIR;
  return typeof fromEnv === "string" ? fromEnv.trim() : "";
}

function pickSessionDir({ argv, env, appData, home }) {
  const raw = rawSessionDir(argv, env);
  if (!raw) return "";
  const resolved = path.resolve(raw);
  const roots = [appData, home ? path.join(home, "Library") : ""]
    .filter(Boolean)
    .map((root) => path.resolve(root));
  const inside = roots.some((root) => resolved === root || resolved.startsWith(root + path.sep));
  if (!inside) return "";
  try {
    if (!fs.statSync(resolved).isDirectory()) return "";
  } catch (_) {
    return "";
  }
  return resolved;
}

module.exports = { pickSessionDir };
