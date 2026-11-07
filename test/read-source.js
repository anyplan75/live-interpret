const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const root = path.join(__dirname, "..");

function readSource(rel) {
  const full = path.join(root, rel);
  const text = fs.readFileSync(full, "utf8");
  const m = text.match(/\b(?:const|var) b64 = "([A-Za-z0-9+/=]+)";/);
  if (m) {
    return zlib.gunzipSync(Buffer.from(m[1], "base64")).toString("utf8");
  }
  if (rel.replace(/\\/g, "/").endsWith("broadcast/renderer/renderer.js") || rel.endsWith("renderer.js")) {
    if (text.includes("renderer.payload.0.b64")) {
      const dir = path.dirname(full);
      const b64 = fs.readFileSync(path.join(dir, "renderer.payload.0.b64"), "utf8").trim()
        + fs.readFileSync(path.join(dir, "renderer.payload.1.b64"), "utf8").trim();
      return zlib.gunzipSync(Buffer.from(b64, "base64")).toString("utf8");
    }
  }
  return text;
}

module.exports = { readSource, root };
