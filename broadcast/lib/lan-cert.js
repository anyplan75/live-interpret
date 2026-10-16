const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const forge = require("node-forge");

const DAYS = 800;

function stamp(offsetMs) {
  return new Date(Date.now() + offsetMs);
}

function uniqueIps(ips) {
  const out = [];
  (ips || []).forEach((ip) => {
    const text = String(ip || "").trim();
    if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(text)) return;
    if (!out.includes(text)) out.push(text);
  });
  if (!out.includes("127.0.0.1")) out.push("127.0.0.1");
  return out;
}

function writePem(file, text, mode) {
  fs.writeFileSync(file, text);
  try { fs.chmodSync(file, mode); } catch (_) { /* 일부 볼륨은 권한을 바꾸지 않습니다 */ }
}

function ensureCa(dir) {
  const keyPath = path.join(dir, "ca.key");
  const certPath = path.join(dir, "ca.crt");
  if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
    return {
      key: forge.pki.privateKeyFromPem(fs.readFileSync(keyPath, "utf8")),
      cert: forge.pki.certificateFromPem(fs.readFileSync(certPath, "utf8")),
    };
  }
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = crypto.randomBytes(16).toString("hex");
  cert.validity.notBefore = stamp(-5 * 60 * 1000);
  cert.validity.notAfter = stamp(DAYS * 24 * 60 * 60 * 1000);
  const attrs = [{ name: "commonName", value: "Live Interpret LAN" }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.setExtensions([
    { name: "basicConstraints", cA: true, critical: true },
    { name: "keyUsage", keyCertSign: true, cRLSign: true, critical: true },
    { name: "subjectKeyIdentifier" },
  ]);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  fs.mkdirSync(dir, { recursive: true });
  writePem(keyPath, forge.pki.privateKeyToPem(keys.privateKey), 0o600);
  writePem(certPath, forge.pki.certificateToPem(cert), 0o644);
  return { key: keys.privateKey, cert };
}

function issueServer(ca, ips) {
  const names = uniqueIps(ips);
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = crypto.randomBytes(16).toString("hex");
  cert.validity.notBefore = stamp(-5 * 60 * 1000);
  cert.validity.notAfter = stamp(DAYS * 24 * 60 * 60 * 1000);
  cert.setSubject([{ name: "commonName", value: names[0] }]);
  cert.setIssuer(ca.cert.subject.attributes);
  cert.setExtensions([
    { name: "basicConstraints", cA: false },
    { name: "keyUsage", digitalSignature: true, keyEncipherment: true },
    { name: "extKeyUsage", serverAuth: true },
    { name: "subjectAltName", altNames: names.map((ip) => ({ type: 7, ip })) },
    { name: "subjectKeyIdentifier" },
  ]);
  cert.sign(ca.key, forge.md.sha256.create());
  return {
    keyPem: forge.pki.privateKeyToPem(keys.privateKey),
    certPem: forge.pki.certificateToPem(cert),
    ips: names,
  };
}

function loadOrCreate(dir, ips) {
  fs.mkdirSync(dir, { recursive: true });
  const names = uniqueIps(ips);
  const stampPath = path.join(dir, "server-ips.json");
  const keyPath = path.join(dir, "server.key");
  const certPath = path.join(dir, "server.crt");
  const wanted = JSON.stringify(names);
  if (fs.existsSync(keyPath) && fs.existsSync(certPath) && fs.existsSync(stampPath)) {
    if (fs.readFileSync(stampPath, "utf8") === wanted) {
      return {
        keyPem: fs.readFileSync(keyPath, "utf8"),
        certPem: fs.readFileSync(certPath, "utf8"),
        caPem: fs.readFileSync(path.join(dir, "ca.crt"), "utf8"),
        ips: names,
      };
    }
  }
  const ca = ensureCa(dir);
  const issued = issueServer(ca, names);
  writePem(keyPath, issued.keyPem, 0o600);
  writePem(certPath, issued.certPem, 0o644);
  fs.writeFileSync(stampPath, wanted);
  return {
    keyPem: issued.keyPem,
    certPem: issued.certPem,
    caPem: forge.pki.certificateToPem(ca.cert),
    ips: issued.ips,
  };
}

function mobileconfig(caPem) {
  const cert = forge.pki.certificateFromPem(caPem);
  const der = forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes();
  const b64 = forge.util.encode64(der).replace(/(.{64})/g, "$1\n");
  const id = crypto.randomUUID();
  const inner = crypto.randomUUID();
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>PayloadContent</key>
  <array>
    <dict>
      <key>PayloadCertificateFileName</key>
      <string>live-interpret-ca.crt</string>
      <key>PayloadContent</key>
      <data>${b64}</data>
      <key>PayloadDescription</key>
      <string>송출 컴퓨터의 마이크 페이지를 열기 위한 인증서</string>
      <key>PayloadDisplayName</key>
      <string>실시간 통역 마이크</string>
      <key>PayloadIdentifier</key>
      <string>com.anyplan.live-interpret.lan-ca</string>
      <key>PayloadType</key>
      <string>com.apple.security.root</string>
      <key>PayloadUUID</key>
      <string>${inner}</string>
      <key>PayloadVersion</key>
      <integer>1</integer>
    </dict>
  </array>
  <key>PayloadDisplayName</key>
  <string>실시간 통역 마이크</string>
  <key>PayloadIdentifier</key>
  <string>com.anyplan.live-interpret.lan-trust</string>
  <key>PayloadRemovalDisallowed</key>
  <false/>
  <key>PayloadType</key>
  <string>Configuration</string>
  <key>PayloadUUID</key>
  <string>${id}</string>
  <key>PayloadVersion</key>
  <integer>1</integer>
</dict>
</plist>
`;
}

module.exports = { loadOrCreate, mobileconfig, uniqueIps };
