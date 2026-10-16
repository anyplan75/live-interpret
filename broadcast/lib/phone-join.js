const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const https = require("https");
const path = require("path");
const { WebSocketServer } = require("ws");
const QRCode = require("qrcode");
const { lanIPv4s, joinUrl } = require("./lan-address");
const { loadOrCreate, mobileconfig } = require("./lan-cert");
const { cleanDisplayName, cleanPhoneId } = require("./phone-name");

const pageFile = path.join(__dirname, "..", "phone", "join.html");
const pcmFile = path.join(__dirname, "pcm16.js");

function phonePage() {
  const html = fs.readFileSync(pageFile, "utf8");
  const helper = fs.readFileSync(pcmFile, "utf8");
  return html.replace("/*__PCM16__*/", helper);
}

function secureCheckPage() {
  return `<!DOCTYPE html>
<meta charset="utf-8">
<title>secure-check</title>
<body><script>
document.body.textContent = JSON.stringify({
  isSecureContext: window.isSecureContext,
  hasMedia: !!(navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === "function"),
  protocol: location.protocol
});
</script></body>`;
}

function closeServer(server) {
  if (!server) return Promise.resolve();
  return new Promise((resolve) => {
    server.close(() => resolve());
  });
}

function listen(server, host, port) {
  return new Promise((resolve, reject) => {
    const onError = (err) => {
      server.removeListener("listening", onListen);
      reject(err);
    };
    const onListen = () => {
      server.removeListener("error", onError);
      resolve(server.address().port);
    };
    server.once("error", onError);
    server.listen(port, host, onListen);
  });
}

class PhoneJoin {
  constructor(hooks) {
    const extra = hooks || {};
    this.onHello = extra.onHello || (() => ({ index: 0 }));
    this.onPcm = extra.onPcm || (() => {});
    this.onLeave = extra.onLeave || (() => {});
    this.httpsServer = null;
    this.httpServer = null;
    this.wss = null;
    this.sockets = new Map();
    this.certDir = "";
    this.bindHost = "0.0.0.0";
    this.advertiseHost = "";
    this.cert = null;
    this.infoCache = {
      url: "",
      certUrl: "",
      qrDataUrl: "",
      host: "",
      ips: [],
      note: "송출 컴퓨터를 같은 Wi-Fi에 연결하면 참여 주소가 나옵니다.",
    };
  }

  info() {
    return { ...this.infoCache, ips: (this.infoCache.ips || []).slice() };
  }

  async start(opts) {
    const options = opts || {};
    if (this.httpsServer) return this.info();
    this.certDir = options.certDir;
    if (!this.certDir) throw new Error("인증서 폴더가 없습니다.");
    this.bindHost = options.bindHost || "0.0.0.0";
    const lan = lanIPv4s();
    const host = options.advertiseHost || lan.primary;
    const ips = options.advertiseHost ? [options.advertiseHost].concat(lan.all) : lan.all.slice();
    this.cert = loadOrCreate(this.certDir, ips);
    const page = phonePage();
    const check = secureCheckPage();
    const profile = mobileconfig(this.cert.caPem);
    const respond = (req, res, secure) => this._respond(req, res, secure, page, check, profile);

    const httpsServer = https.createServer({ key: this.cert.keyPem, cert: this.cert.certPem }, (req, res) => {
      respond(req, res, true);
    });
    const httpServer = http.createServer((req, res) => respond(req, res, false));
    const preferredHttps = Number.isInteger(options.httpsPort) ? options.httpsPort : 8443;
    const preferredHttp = Number.isInteger(options.httpPort) ? options.httpPort : 8787;
    try {
      try {
        await listen(httpsServer, this.bindHost, preferredHttps);
      } catch (err) {
        if (!options.strictPort && err && err.code === "EADDRINUSE") await listen(httpsServer, this.bindHost, 0);
        else throw err;
      }
      try {
        await listen(httpServer, this.bindHost, preferredHttp);
      } catch (err) {
        if (!options.strictPort && err && err.code === "EADDRINUSE") await listen(httpServer, this.bindHost, 0);
        else throw err;
      }
    } catch (err) {
      httpsServer.close();
      httpServer.close();
      throw err;
    }
    this.httpsServer = httpsServer;
    this.httpServer = httpServer;
    this.wss = new WebSocketServer({ server: httpsServer, path: "/mic", maxPayload: 1024 * 1024, perMessageDeflate: false });
    this.wss.on("connection", (socket) => this._onSocket(socket));
    await this._publish(host, httpsServer.address().port, httpServer.address().port, lan.all);
    return this.info();
  }

  async _publish(host, httpsPort, httpPort, ips) {
    if (!host) {
      this.advertiseHost = "";
      this.infoCache = {
        url: "",
        certUrl: "",
        qrDataUrl: "",
        host: "",
        ips: ips || [],
        note: "송출 컴퓨터를 같은 Wi-Fi에 연결하면 참여 주소가 나옵니다.",
      };
      return;
    }
    const url = joinUrl(host, httpsPort);
    if (url.startsWith("http://")) throw new Error("참여 주소는 https 여야 합니다.");
    const certUrl = `http://${host}:${httpPort}/trust.mobileconfig`;
    const qrDataUrl = await QRCode.toDataURL(url, { margin: 1, width: 320, errorCorrectionLevel: "M" });
    this.advertiseHost = host;
    this.infoCache = {
      url,
      certUrl,
      qrDataUrl,
      host,
      ips: ips || [],
      note: "",
    };
  }

  _respond(req, res, secure, page, check, profile) {
    const location = new URL(req.url || "/", "https://join.local");
    const pathname = location.pathname;
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("허용되지 않는 요청입니다.");
      return;
    }
    if (pathname === "/trust.mobileconfig") {
      res.writeHead(200, {
        "Content-Type": "application/x-apple-aspen-config",
        "Content-Disposition": "attachment; filename=live-interpret-mic.mobileconfig",
        "Cache-Control": "no-store",
      });
      res.end(req.method === "HEAD" ? undefined : profile);
      return;
    }
    if (pathname === "/ca.crt") {
      res.writeHead(200, {
        "Content-Type": "application/x-x509-ca-cert",
        "Content-Disposition": "attachment; filename=live-interpret-ca.crt",
        "Cache-Control": "no-store",
      });
      res.end(req.method === "HEAD" ? undefined : this.cert.caPem);
      return;
    }
    if (!secure) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
      res.end("마이크 페이지는 송출 컴퓨터의 https 참여 주소에서만 열립니다.");
      return;
    }
    if (pathname === "/" || pathname === "/join") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      res.end(req.method === "HEAD" ? undefined : page);
      return;
    }
    if (pathname === "/secure-check") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      res.end(req.method === "HEAD" ? undefined : check);
      return;
    }
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("없는 주소입니다.");
  }

  _onSocket(socket) {
    let phoneId = "";
    socket.on("message", (data, isBinary) => {
      if (isBinary) {
        if (!phoneId) return;
        const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
        const even = buf.length - (buf.length % 2);
        if (even < 2) return;
        this.onPcm(phoneId, even === buf.length ? buf : buf.subarray(0, even));
        return;
      }
      let message = null;
      try { message = JSON.parse(data.toString()); } catch (_) { return; }
      if (!message || message.type !== "hello") return;
      const name = cleanDisplayName(message.name);
      if (!name) {
        socket.send(JSON.stringify({ type: "error", message: "이름을 입력해 주세요." }));
        return;
      }
      const requested = cleanPhoneId(message.phoneId) || crypto.randomBytes(16).toString("hex");
      let joined;
      try {
        joined = this.onHello({ id: requested, name });
      } catch (err) {
        socket.send(JSON.stringify({ type: "error", message: err.message || "연결하지 못했습니다." }));
        return;
      }
      phoneId = joined.phoneId || requested;
      const previous = this.sockets.get(phoneId);
      this.sockets.set(phoneId, socket);
      if (previous && previous !== socket) previous.close();
      socket.send(JSON.stringify({
        type: "joined",
        phoneId,
        name: joined.name || name,
        channel: joined.index,
      }));
      socket.send(JSON.stringify({ type: "state", listening: !!joined.listening }));
    });
    socket.on("close", () => {
      if (!phoneId) return;
      if (this.sockets.get(phoneId) !== socket) return;
      this.sockets.delete(phoneId);
      this.onLeave(phoneId);
    });
  }

  setListening(phoneId, listening) {
    const socket = this.sockets.get(phoneId);
    if (!socket || socket.readyState !== 1) return;
    socket.send(JSON.stringify({ type: "state", listening: !!listening }));
  }

  async refresh() {
    if (!this.httpsServer) return { ...this.info(), changed: false };
    const lan = lanIPv4s();
    const host = lan.primary;
    if (!host || host === this.advertiseHost) return { ...this.info(), changed: false };
    const known = new Set((this.cert && this.cert.ips) || []);
    if (!known.has(host)) return { ...this.info(), changed: false };
    await this._publish(host, this.httpsServer.address().port, this.httpServer.address().port, lan.all);
    return { ...this.info(), changed: true };
  }

  async stop() {
    const sockets = [...this.sockets.values()];
    this.sockets.clear();
    sockets.forEach((socket) => {
      try { socket.close(); } catch (_) { /* 이미 닫힌 연결은 무시합니다 */ }
    });
    if (this.wss) {
      await new Promise((resolve) => this.wss.close(() => resolve()));
      this.wss = null;
    }
    await closeServer(this.httpsServer);
    await closeServer(this.httpServer);
    this.httpsServer = null;
    this.httpServer = null;
  }
}

module.exports = { PhoneJoin, phonePage, secureCheckPage };
