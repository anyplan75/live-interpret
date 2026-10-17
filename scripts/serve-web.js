const http = require("http");
const fs = require("fs");
const path = require("path");
require("../broadcast/lib/load-env");

const root = path.join(__dirname, "..", "docs");
const port = Number(process.env.PORT || 8080);
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${port}`);
  let rel = decodeURIComponent(url.pathname);
  if (rel.endsWith("/")) rel += "index.html";
  if (rel === "/js/runtime-env.js") {
    const key = process.env.FIREBASE_API_KEY || "";
    const body = `globalThis.LI_ENV = { FIREBASE_API_KEY: ${JSON.stringify(key)} };\n`;
    res.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8" });
    res.end(body);
    return;
  }
  const file = path.normalize(path.join(root, rel));
  if (file !== root && !file.startsWith(root + path.sep)) {
    res.writeHead(403);
    res.end("forbidden");
    return;
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end("not found");
      return;
    }
    res.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream" });
    res.end(data);
  });
});

server.listen(port, "127.0.0.1", () => {
  console.log(`http://127.0.0.1:${port}/admin.html`);
});
