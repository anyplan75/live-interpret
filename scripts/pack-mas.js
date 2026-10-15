"use strict";

const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const {
  readCodesigningIdentities,
  findMasDistributionIdentity,
  findMasProvisioningProfile,
  expectedMasCertificateName,
  expectedMasProvisioningProfileName,
} = require("./mas-signing");

const root = path.join(__dirname, "..");

function run(cmd, args, env) {
  const result = spawnSync(cmd, args, { cwd: root, stdio: "inherit", env });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status == null ? 1 : result.status);
}

function main() {
  if (process.platform !== "darwin") {
    console.error("Mac App Store 패키지는 macOS에서만 만듭니다.");
    process.exit(1);
  }

  const builder = path.join(root, "node_modules", ".bin", "electron-builder");
  if (!fs.existsSync(builder)) {
    console.error("electron-builder 가 없습니다. 먼저 npm install 을 실행하세요.");
    process.exit(1);
  }

  const identities = readCodesigningIdentities();
  const identity = identities.ok ? findMasDistributionIdentity(identities.output) : "";
  const profile = findMasProvisioningProfile();

  if (!identity || !profile) {
    console.error("Mac App Store 패키지를 건너뜁니다. 서명 자료가 이 Mac에 없습니다.");
    if (!identity) {
      console.error(`  필요한 codesigning 인증서: ${expectedMasCertificateName()}`);
      console.error("  (또는 3rd Party Mac Developer Application: … (ZJYZ656BL8))");
      if (!identities.ok && identities.error) console.error(`  keychain: ${identities.error}`);
    }
    if (!profile) {
      console.error(`  필요한 provisioning profile: ${expectedMasProvisioningProfileName()}`);
    }
    process.exit(0);
  }

  console.log(`Mac App Store 인증서: ${identity}`);
  console.log(`Provisioning profile: ${profile.name}`);
  console.log(profile.path);

  const env = { ...process.env };
  if (!env.APPLE_TEAM_ID) env.APPLE_TEAM_ID = "ZJYZ656BL8";

  run(builder, [
    "--mac",
    "mas",
    "--arm64",
    "--publish",
    "never",
    `-c.mas.identity=ZJYZ656BL8`,
    `-c.mas.provisioningProfile=${profile.path}`,
  ], env);

  const pkg = require(path.join(root, "package.json"));
  const version = pkg.version || "0.0.0";
  const pkgPath = path.join(root, "dist", `live-interpret-${version}-mas-arm64.pkg`);
  if (fs.existsSync(pkgPath)) {
    console.log(pkgPath);
  }
}

if (require.main === module) main();

module.exports = { main };
