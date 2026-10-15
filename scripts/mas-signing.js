"use strict";

const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const TEAM_ID = "ZJYZ656BL8";
const BUNDLE_ID = "com.anyplan.live-interpret";

const MAS_IDENTITY_HINTS = [
  `Apple Distribution:`,
  "3rd Party Mac Developer Application:",
];

function loginKeychainPath() {
  const dir = path.join(process.env.HOME || "", "Library", "Keychains");
  const modern = path.join(dir, "login.keychain-db");
  const legacy = path.join(dir, "login.keychain");
  if (fs.existsSync(modern)) return modern;
  if (fs.existsSync(legacy)) return legacy;
  return modern;
}

function readCodesigningIdentities() {
  const keychain = loginKeychainPath();
  const result = spawnSync("security", ["find-identity", "-v", "-p", "codesigning", keychain], {
    encoding: "utf8",
  });
  return {
    ok: result.status === 0,
    output: result.stdout || "",
    error: String(result.stderr || (result.error && result.error.message) || "").trim(),
  };
}

function findMasDistributionIdentity(identitiesOutput) {
  const needle = `(${TEAM_ID})`;
  const lines = String(identitiesOutput || "").split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line.includes(needle)) continue;
    if (!MAS_IDENTITY_HINTS.some((hint) => line.includes(hint))) continue;
    const match = line.match(/"([^"]+)"/);
    if (match) return match[1];
  }
  return "";
}

function expectedMasCertificateName() {
  return `Apple Distribution: JUN CHO (${TEAM_ID})`;
}

function provisioningProfileDirs() {
  const home = process.env.HOME || "";
  return [
    path.join(home, "Library/MobileDevice/Provisioning Profiles"),
    path.join(home, "Library/Developer/Xcode/UserData/Provisioning Profiles"),
  ];
}

function decodeProvisioningProfile(filePath) {
  const result = spawnSync("security", ["cms", "-D", "-i", filePath], { encoding: "utf8" });
  if (result.status !== 0) return "";
  return result.stdout || "";
}

function profileNameFromXml(xml) {
  const match = xml.match(/<key>Name<\/key>\s*<string>([^<]*)<\/string>/);
  return match ? match[1] : "";
}

function isMacAppStoreProfile(xml, bundleId) {
  if (!xml || !xml.includes(bundleId)) return false;
  if (xml.includes("<string>iphoneos</string>") || xml.includes("<string>iOS</string>")) return false;
  if (xml.includes("<string>macosx</string>") || xml.includes("Mac OS X")) return true;
  if (xml.includes("ProvisionedDevices")) return false;
  return xml.includes(`<string>${bundleId}</string>`) || xml.includes(`${TEAM_ID}.${bundleId}`);
}

function findMasProvisioningProfile(bundleId = BUNDLE_ID) {
  const matches = [];
  provisioningProfileDirs().forEach((dir) => {
    if (!fs.existsSync(dir)) return;
    fs.readdirSync(dir).forEach((name) => {
      if (!/\.(provisionprofile|mobileprovision)$/.test(name)) return;
      const filePath = path.join(dir, name);
      const xml = decodeProvisioningProfile(filePath);
      if (!isMacAppStoreProfile(xml, bundleId)) return;
      matches.push({
        path: filePath,
        name: profileNameFromXml(xml) || name,
      });
    });
  });
  if (!matches.length) return null;
  matches.sort((a, b) => a.name.localeCompare(b.name, "en"));
  return matches[0];
}

function expectedMasProvisioningProfileName() {
  return `Mac App Store provisioning profile for ${BUNDLE_ID} (Team ${TEAM_ID})`;
}

module.exports = {
  TEAM_ID,
  BUNDLE_ID,
  readCodesigningIdentities,
  findMasDistributionIdentity,
  findMasProvisioningProfile,
  expectedMasCertificateName,
  expectedMasProvisioningProfileName,
};
