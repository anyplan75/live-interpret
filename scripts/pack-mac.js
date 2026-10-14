"use strict";

const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const pkg = require(path.join(root, "package.json"));
const TEAM_ID = pkg.build && pkg.build.mac && pkg.build.mac.identity;

function findDeveloperIdLine(findIdentityOutput, teamId) {
  const needle = "(" + teamId + ")";
  const lines = String(findIdentityOutput || "").split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (line.includes("Developer ID Application:") && line.includes(needle)) return line;
  }
  return "";
}

function notarizationCredentials(env) {
  if (env.APPLE_ID && env.APPLE_APP_SPECIFIC_PASSWORD) return "apple-id";
  if (env.APPLE_API_KEY && env.APPLE_API_KEY_ID && env.APPLE_API_ISSUER) return "api-key";
  if (env.APPLE_KEYCHAIN_PROFILE) return "keychain-profile";
  return "";
}

function loginKeychainPath() {
  const dir = path.join(process.env.HOME || "", "Library", "Keychains");
  const modern = path.join(dir, "login.keychain-db");
  const legacy = path.join(dir, "login.keychain");
  if (fs.existsSync(modern)) return modern;
  if (fs.existsSync(legacy)) return legacy;
  return modern;
}

function readLoginIdentities() {
  const keychain = loginKeychainPath();
  const result = spawnSync("security", ["find-identity", "-v", "-p", "codesigning", keychain], {
    encoding: "utf8",
  });
  return {
    ok: result.status === 0,
    output: result.stdout || "",
    error: String(result.stderr || (result.error && result.error.message) || "").trim(),
    keychain,
  };
}

function run(cmd, args, env) {
  const result = spawnSync(cmd, args, { cwd: root, stdio: "inherit", env });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status == null ? 1 : result.status);
}

function main() {
  if (!/^[A-Z0-9]{10}$/.test(TEAM_ID || "")) {
    console.error("package.json build.mac.identity 에 Apple Team ID 10자가 없습니다. 인증서 공통 이름은 넣지 않습니다.");
    process.exit(1);
  }
  if (process.platform !== "darwin") {
    console.error("Mac 앱 만들기는 macOS에서만 합니다. 이 컴퓨터에서는 만들지 않습니다.");
    process.exit(1);
  }

  const dist = process.argv.includes("--dist");
  const identities = readLoginIdentities();
  const identityLine = identities.ok ? findDeveloperIdLine(identities.output, TEAM_ID) : "";
  const env = { ...process.env };
  const builderArgs = dist
    ? ["--mac", "--arm64", "--publish", "never"]
    : ["--mac", "dir", "--arm64"];
  const builder = path.join(root, "node_modules", ".bin", "electron-builder");

  if (!fs.existsSync(builder)) {
    console.error("electron-builder 가 없습니다. 먼저 npm install 을 실행하세요.");
    process.exit(1);
  }

  if (identityLine) {
    if (!env.APPLE_TEAM_ID) env.APPLE_TEAM_ID = TEAM_ID;
    builderArgs.push("-c.mac.hardenedRuntime=true");
    console.log("Developer ID Application 인증서로 서명합니다. Team ID " + TEAM_ID + ".");
    console.log(identityLine);
    const creds = notarizationCredentials(env);
    if (creds) {
      console.log("공증 자격 증명이 있어 공증을 시도합니다. (" + creds + ")");
    } else {
      console.log("공증 자격 증명이 없습니다. 서명은 하고, 공증은 건너뜁니다.");
      console.log("공증하려면 APPLE_ID 와 APPLE_APP_SPECIFIC_PASSWORD, 또는 APPLE_API_KEY / APPLE_API_KEY_ID / APPLE_API_ISSUER, 또는 APPLE_KEYCHAIN_PROFILE 을 환경 변수로 두세요. 저장소에는 넣지 않습니다.");
    }
  } else {
    console.log("============================================================");
    console.log("로그인 키체인에 Team ID " + TEAM_ID + " 의 Developer ID Application 인증서가 없습니다.");
    if (!identities.ok && identities.error) console.log(identities.error);
    console.log("임시 서명으로 대체합니다: codesign --sign -");
    console.log("이 앱은 이 Mac 밖에서 Gatekeeper를 통과하지 않습니다.");
    console.log("============================================================");
    builderArgs.push("-c.mac.identity=-");
  }

  run(builder, builderArgs, env);
  if (!dist) {
    run(process.execPath, [path.join(__dirname, "name-mac-app.js")], env);
    if (!identityLine) {
      const app = path.join(root, "dist", "mac-arm64", "실시간 통역시스템.app");
      console.log("ad-hoc 서명: codesign --force --deep --sign - \"" + app + "\"");
      run("codesign", ["--force", "--deep", "--sign", "-", app], env);
    }
  }
}

if (require.main === module) main();

module.exports = {
  TEAM_ID,
  findDeveloperIdLine,
  notarizationCredentials,
};
