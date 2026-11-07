const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const dir = path.join(__dirname, "..", "broadcast", "lib");
const h = [0, 1, 2].map((i) => fs.readFileSync(path.join(dir, `engine.hex.${i}.txt`), "utf8")).join("");
const out = Buffer.from(h, "hex");
fs.writeFileSync(path.join(dir, "engine.js"), out);
const sha = crypto.createHash("sha256").update(out).digest("hex");
console.log("wrote engine.js", out.length, sha);
if (sha !== "9f9a1dc3845e9c07734ac2415442de0ef7e79d55939c71e684eda95179e5985e") {
  console.error("SHA mismatch");
  process.exit(1);
}
