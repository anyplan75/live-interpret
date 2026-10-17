const fs = require("fs");
const path = require("path");

function applyEnvText(text) {
  String(text || "").split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) return;
    const key = trimmed.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return;
    if (process.env[key]) return;
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  });
}

function candidateFiles() {
  const found = [];
  const add = (file) => {
    const abs = path.resolve(file);
    if (!found.includes(abs)) found.push(abs);
  };
  add(path.join(process.cwd(), ".env"));
  add(path.join(__dirname, "..", "..", ".env"));
  if (process.resourcesPath) {
    add(path.join(process.resourcesPath, ".env"));
    add(path.join(process.resourcesPath, "..", ".env"));
  }
  return found;
}

function loadEnv() {
  candidateFiles().forEach((file) => {
    try {
      if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return;
      applyEnvText(fs.readFileSync(file, "utf8"));
    } catch (_) {
      /* 다음 후보를 봅니다 */
    }
  });
}

loadEnv();

module.exports = { loadEnv };
