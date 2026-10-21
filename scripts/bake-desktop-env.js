"use strict";

const { execFileSync, spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

function parseEnvValue(text, name) {
  let value = "";
  let found = false;
  for (const line of String(text || "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    if (trimmed.slice(0, eq).trim() !== name) continue;
    found = true;
    value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
  }
  return found ? value : "";
}

function mainCheckoutEnv(projectDir) {
  try {
    const common = execFileSync("git", ["rev-parse", "--git-common-dir"], {
      cwd: projectDir,
      encoding: "utf8",
    }).trim();
    const gitDir = path.resolve(projectDir, common);
    const root = path.basename(gitDir) === ".git" ? path.dirname(gitDir) : projectDir;
    return path.join(root, ".env");
  } catch (_) {
    return "";
  }
}

function findEnvFile(projectDir) {
  const candidates = [path.join(projectDir, ".env"), mainCheckoutEnv(projectDir)].filter(Boolean);
  const seen = new Set();
  for (const file of candidates) {
    const abs = path.resolve(file);
    if (seen.has(abs)) continue;
    seen.add(abs);
    if (fs.existsSync(abs) && fs.statSync(abs).isFile()) return abs;
  }
  return "";
}

function resourcesDir(context) {
  const appOutDir = context.appOutDir;
  if (context.electronPlatformName === "darwin" || context.electronPlatformName === "mas") {
    const apps = fs.readdirSync(appOutDir).filter((name) => name.endsWith(".app"));
    if (apps.length !== 1) throw new Error("설치 앱 폴더를 찾지 못했습니다.");
    return path.join(appOutDir, apps[0], "Contents", "Resources");
  }
  return path.join(appOutDir, "resources");
}

function packagedEnvText(apiKey) {
  if (!apiKey || /[\r\n\u0000]/.test(apiKey)) {
    throw new Error("FIREBASE_API_KEY 가 비어 있습니다.");
  }
  return `FIREBASE_API_KEY=${apiKey}\n`;
}

async function bakeInto(context, opts = {}) {
  const log = opts.log || ((message) => console.log(message));
  const projectDir = opts.projectDir
    || (context.packager && context.packager.info && context.packager.info.projectDir)
    || path.join(__dirname, "..");
  const envFile = opts.envFile || findEnvFile(projectDir);
  if (!envFile) {
    if (process.env.GITHUB_ACTIONS === "true") {
      log("GitHub Actions 에는 .env 가 없어 설치 파일에 웹 접속 키를 넣지 않습니다.");
      return "";
    }
    throw new Error("FIREBASE_API_KEY 를 읽을 .env 가 없습니다. 비밀 파일에만 두고, 저장소에는 넣지 않습니다.");
  }
  const envText = opts.envText != null ? opts.envText : fs.readFileSync(envFile, "utf8");
  const apiKey = parseEnvValue(envText, "FIREBASE_API_KEY").trim();
  if (!apiKey) {
    throw new Error("FIREBASE_API_KEY 가 비어 있습니다. .env 에 값을 넣은 뒤 설치 파일을 다시 만드세요.");
  }
  const dir = resourcesDir(context);
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, ".env");
  // 맥 앱스토어 패키지는 루트만 읽는 파일을 거절한다. 앱을 실행하는 사용자도 이 파일을 읽을 수 있어야 한다.
  fs.writeFileSync(dest, packagedEnvText(apiKey), { mode: 0o644 });
  log(`설치 파일에 Firebase 웹 접속 키를 넣었습니다. 길이 ${apiKey.length}`);
  alignMasHelperNames(context, log);
  return dest;
}

function alignMasHelperNames(context, log) {
  const appOutDir = context && context.appOutDir;
  if (!appOutDir || path.basename(appOutDir).indexOf("mas-") !== 0) return;
  const script = path.join(__dirname, "name-mac-app.js");
  const result = spawnSync(process.execPath, [script, appOutDir, "--nfd-bundle-name"], { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(String(result.stderr || result.stdout || "앱 이름표를 맞추지 못했습니다."));
  }
  log("맥 앱스토어 앱 이름표를 도우미 폴더와 같은 한글 저장 방식으로 맞췄습니다.");
}

module.exports = bakeInto;
module.exports.afterPack = bakeInto;
module.exports.parseEnvValue = parseEnvValue;
module.exports.packagedEnvText = packagedEnvText;
module.exports.findEnvFile = findEnvFile;
