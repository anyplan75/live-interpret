const crypto = require("crypto");
const QRCode = require("qrcode");
const catalog = require("./catalog");
const orgServices = require("../../docs/js/org-services");
const { netFetch } = require("./net-fetch");
const { cleanDisplayName, cleanPhoneId } = require("./phone-name");

const PEER_RE = /^[A-Za-z0-9_-]{8,64}$/;
const ICE_ID_RE = /^[A-Za-z0-9_-]{8,32}$/;

function publicMicUrl(pagesBase, token) {
  const base = String(pagesBase || "").replace(/\/$/, "");
  let parsed;
  try {
    parsed = new URL(base);
  } catch (_) {
    throw new Error("참여 페이지 주소가 올바르지 않습니다.");
  }
  if (parsed.protocol !== "https:") throw new Error("참여 페이지는 https 여야 합니다.");
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(parsed.hostname)) {
    throw new Error("참여 페이지는 공인 https 주소여야 합니다.");
  }
  if (!/^[a-f0-9]{32}$/.test(token || "")) throw new Error("참여 토큰이 올바르지 않습니다.");
  return `${parsed.origin}${parsed.pathname.replace(/\/$/, "")}/mic/?s=${token}`;
}

function parseIce(value) {
  if (typeof value !== "string" || !value || value.length > 2000) return null;
  let body;
  try {
    body = JSON.parse(value);
  } catch (_) {
    return null;
  }
  if (!body || typeof body.candidate !== "string" || !body.candidate || body.candidate.length > 1500) return null;
  if (/\btyp relay\b/.test(body.candidate)) return null;
  return {
    candidate: body.candidate,
    sdpMid: typeof body.sdpMid === "string" && body.sdpMid ? body.sdpMid : "0",
    sdpMLineIndex: Number.isInteger(body.sdpMLineIndex) ? body.sdpMLineIndex : 0,
  };
}

function encodeIce(candidate) {
  const text = JSON.stringify({
    candidate: candidate.candidate,
    sdpMid: candidate.sdpMid || "0",
    sdpMLineIndex: Number.isInteger(candidate.sdpMLineIndex) ? candidate.sdpMLineIndex : 0,
  });
  if (!text || text.length > 2000) return "";
  return text;
}

function asBuffer(data) {
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data);
  if (ArrayBuffer.isView(data)) return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  return Buffer.from(data);
}

class PhoneJoin {
  constructor(hooks) {
    const extra = hooks || {};
    this.onHello = extra.onHello || (() => ({ index: 0 }));
    this.onPcm = extra.onPcm || (() => {});
    this.onLeave = extra.onLeave || (() => {});
    this.onError = extra.onError || (() => {});
    this.link = null;
    this.pending = [];
    this.peers = new Map();
    this.seenOffers = new Set();
    this.seenIce = new Set();
    this.onChange = extra.onChange || (() => {});
    this.token = "";
    this.desks = [];
    this.sessionOpen = false;
    this.databaseURL = "";
    this.started = false;
    this.stopped = false;
    this.watching = false;
    this.timer = null;
    this.lastFail = 0;
    this.lastFailText = "";
    this.infoCache = {
      url: "",
      qrDataUrl: "",
      host: "",
      ips: [],
      note: "송출 컴퓨터를 같은 Wi-Fi에 연결하면 참여 주소가 나옵니다.",
    };
  }

  info() {
    const channels = this.sessionOpen ? this.desks.map((desk, slot) => ({
      slot,
      connectionId: desk.connectionId,
      pin: desk.pin,
      name: desk.name,
      spoken: desk.spoken,
      phoneId: desk.phoneId,
      channelIndex: desk.channelIndex,
      connected: Boolean(desk.holderPeerId),
    })) : [];
    return { ...this.infoCache, ips: (this.infoCache.ips || []).slice(), channels };
  }

  attachLink(link) {
    this.link = link || null;
    if (!this.link) return;
    const queued = this.pending.splice(0);
    queued.forEach((msg) => this._emitLink(msg));
  }

  async start(opts) {
    const options = opts || {};
    if (this.started) return this.info();
    this.started = true;
    this.token = options.token || crypto.randomBytes(16).toString("hex");
    const pages = options.pagesBase || catalog.pagesBase;
    const url = publicMicUrl(pages, this.token);
    const qrDataUrl = await QRCode.toDataURL(url, { margin: 1, width: 320, errorCorrectionLevel: "M" });
    this.databaseURL = String((options.databaseURL || catalog.firebase.databaseURL) || "").replace(/\/$/, "");
    this.infoCache = {
      url,
      qrDataUrl,
      host: "",
      ips: [],
      note: "",
    };
    if (options.signal !== false) this._runWatch();
    return this.info();
  }

  async openSession() {
    this.sessionOpen = true;
    this.desks = [];
    const lectureUrl = orgServices.lectureAppUrl(catalog.pagesBase);
    const qrDataUrl = await QRCode.toDataURL(lectureUrl, { margin: 1, width: 320, errorCorrectionLevel: "M" });
    this.infoCache = {
      ...this.infoCache,
      url: lectureUrl,
      qrDataUrl,
      connectionId: "",
      pin: "",
      note: "휴대폰 채널마다 접속 번호와 4자리 암호가 있습니다. 암호는 저장하지 않습니다.",
    };
    const desk = this.addDesk();
    return { connectionId: desk.connectionId, token: this.token };
  }

  addDesk() {
    if (!this.sessionOpen) throw new Error("방송을 시작한 뒤에 휴대폰 채널을 추가할 수 있습니다.");
    if (this.desks.length >= 8) throw new Error("휴대폰 입력은 8개까지입니다.");
    const connectionId = this._freshConnectionId();
    const pin = orgServices.makeSessionPin();
    this.desks.push({
      connectionId,
      pin,
      holderPeerId: "",
      phoneId: "",
      name: "",
      spoken: "",
      channelIndex: -1,
    });
    return { connectionId, token: this.token };
  }

  dropDesk(connectionId) {
    const id = orgServices.normalizeConnectionId(connectionId);
    const desk = this.desks.find((item) => item.connectionId === id);
    if (!desk || desk.holderPeerId) return false;
    this.desks = this.desks.filter((item) => item.connectionId !== id);
    return true;
  }

  closeSession() {
    const ids = this.desks.map((desk) => desk.connectionId);
    const peers = this.desks.map((desk) => desk.holderPeerId).filter(Boolean);
    this.desks = [];
    this.sessionOpen = false;
    this.infoCache = {
      ...this.infoCache,
      connectionId: "",
      pin: "",
      note: "방송을 시작하면 휴대폰 채널의 접속 번호와 이번 세션 4자리 암호가 나옵니다.",
    };
    peers.forEach((peerId) => this._toLink({ type: "close", peerId }));
    return ids;
  }

  _freshConnectionId() {
    for (let i = 0; i < 12; i += 1) {
      const connectionId = orgServices.makeConnectionId();
      if (!this.desks.some((desk) => desk.connectionId === connectionId)) return connectionId;
    }
    throw new Error("접속 번호를 만들지 못했습니다. 다시 시도해 주세요.");
  }

  _notify() {
    try { this.onChange(); } catch (_) { /* 화면 갱신 실패는 다음 연결 상태에서 다시 보입니다 */ }
  }

  async refresh() {
    return { ...this.info(), changed: false };
  }

  ingestText(peerId, raw) {
    if (!PEER_RE.test(peerId || "")) return;
    let message = null;
    try {
      message = JSON.parse(String(raw || ""));
    } catch (_) {
      return;
    }
    if (!message || message.type !== "hello") return;
    const name = cleanDisplayName(message.name);
    const row = this._peer(peerId);
    if (!name) {
      this._refuse(peerId, "이름을 입력해 주세요.");
      return;
    }
    if (!this.sessionOpen) {
      this._refuse(peerId, "강연·회의가 아직 시작되지 않았습니다.");
      return;
    }
    const connectionId = orgServices.normalizeConnectionId(message.connectionId);
    const desk = connectionId ? this.desks.find((item) => item.connectionId === connectionId) : null;
    if (!desk) {
      this._refuse(peerId, "접속 번호를 확인해 주세요.");
      return;
    }
    const spoken = String(message.spoken || "").trim();
    if (!catalog.langByCode[spoken]) {
      this._refuse(peerId, "말하는 언어를 선택해 주세요.");
      return;
    }
    if (!orgServices.validSessionPin(message.pin) || String(message.pin) !== desk.pin) {
      this._refuse(peerId, "이번 세션 암호가 맞지 않습니다.");
      return;
    }
    const seat = orgServices.claimConnection(desk.holderPeerId, peerId);
    if (!seat.ok) {
      this._refuse(peerId, seat.reason);
      return;
    }
    desk.holderPeerId = seat.holderPeerId;
    const requested = cleanPhoneId(message.phoneId) || crypto.randomBytes(16).toString("hex");
    row.phoneId = requested;
    let joined;
    try {
      joined = this.onHello({ id: requested, name, spoken, connectionId }) || {};
    } catch (err) {
      row.phoneId = "";
      if (desk.holderPeerId === peerId) desk.holderPeerId = "";
      this._refuse(peerId, err.message || "연결하지 못했습니다.");
      return;
    }
    const phoneId = cleanPhoneId(joined.phoneId) || requested;
    row.phoneId = phoneId;
    desk.phoneId = phoneId;
    desk.name = joined.name || name;
    desk.spoken = joined.spoken || spoken;
    desk.channelIndex = Number.isInteger(joined.index) ? joined.index : -1;
    this._send(peerId, {
      type: "joined",
      phoneId,
      name: desk.name,
      channel: desk.channelIndex,
    });
    this._send(peerId, { type: "state", listening: !!joined.listening });
    this._notify();
  }

  ingestPcm(peerId, data) {
    const row = this.peers.get(peerId);
    if (!row || !row.phoneId) return;
    const buf = asBuffer(data);
    const even = buf.length - (buf.length % 2);
    if (even < 2) return;
    this.onPcm(row.phoneId, even === buf.length ? buf : buf.subarray(0, even));
  }

  peerLeft(peerId) {
    const row = this.peers.get(peerId);
    this.peers.delete(peerId);
    if (!row || !row.phoneId) return;
    const phoneId = row.phoneId;
    const desk = this.desks.find((item) => item.holderPeerId === peerId);
    if (desk) desk.holderPeerId = "";
    const still = [...this.peers.values()].some((item) => item.phoneId === phoneId);
    if (!still) this.onLeave(phoneId);
    this._notify();
  }

  _refuse(peerId, message) {
    this._send(peerId, { type: "error", message });
    this._toLink({ type: "close", peerId });
  }

  setListening(phoneId, listening) {
    const id = cleanPhoneId(phoneId);
    if (!id) return;
    for (const [peerId, row] of this.peers) {
      if (row.phoneId !== id) continue;
      this._send(peerId, { type: "state", listening: !!listening });
    }
  }

  async publishAnswer(peerId, sdp) {
    if (!PEER_RE.test(peerId || "") || typeof sdp !== "string" || !sdp || sdp.length > 12000) return;
    await this._put(`peers/${peerId}/answer.json`, { type: "answer", sdp });
  }

  async publishMacIce(msg) {
    const peerId = msg && msg.peerId;
    const text = encodeIce(msg || {});
    if (!PEER_RE.test(peerId || "") || !text) return;
    const iceId = crypto.randomBytes(8).toString("hex");
    await this._put(`peers/${peerId}/macIce/${iceId}.json`, text);
  }

  async stop() {
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.peers.clear();
  }

  _peer(peerId) {
    let row = this.peers.get(peerId);
    if (!row) {
      row = { phoneId: "" };
      this.peers.set(peerId, row);
    }
    return row;
  }

  _send(peerId, message) {
    this._toLink({ type: "send", peerId, text: JSON.stringify(message) });
  }

  _toLink(msg) {
    if (!this.link) {
      this.pending.push(msg);
      return;
    }
    this._emitLink(msg);
  }

  _emitLink(msg) {
    if (!this.link) return;
    if (msg.type === "offer" && this.link.offer) this.link.offer(msg);
    else if (msg.type === "ice" && this.link.ice) this.link.ice(msg);
    else if (msg.type === "send" && this.link.send) this.link.send(msg.peerId, msg.text);
    else if (msg.type === "close" && this.link.close) this.link.close(msg.peerId);
  }

  _signalUrl(suffix) {
    const root = catalog.firebase.rootPath;
    return `${this.databaseURL}/${root}/phoneLinks/${this.token}/${suffix}`;
  }

  async _put(suffix, body) {
    if (!this.databaseURL || !this.token) return;
    const res = await netFetch(this._signalUrl(suffix), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`휴대폰 연결 신호 ${res.status}: ${text.slice(0, 160)}`);
    }
  }

  _runWatch() {
    if (this.watching || this.stopped) return;
    this.watching = true;
    this._watchLoop().catch((err) => this._fail(err));
  }

  async _watchLoop() {
    while (!this.stopped) {
      try {
        await this._pollOnce();
        await this._pause(400);
      } catch (err) {
        if (this.stopped) return;
        this._fail(err);
        await this._pause(2000);
      }
    }
  }

  async _pollOnce() {
    if (!this.databaseURL || !this.token) return;
    const res = await netFetch(this._signalUrl("peers.json"));
    const text = await res.text();
    if (!res.ok) throw new Error(`휴대폰 연결 신호 ${res.status}: ${text.slice(0, 160)}`);
    if (!text || text === "null") return;
    const data = JSON.parse(text);
    this._applyPath("/", data);
  }

  _applyPath(path, data) {
    const parts = String(path || "/").split("/").filter(Boolean);
    if (!parts.length) {
      if (!data || typeof data !== "object") return;
      Object.entries(data).forEach(([peerId, node]) => this._applyPeer(peerId, node));
      return;
    }
    const peerId = parts[0];
    if (!PEER_RE.test(peerId)) return;
    if (parts.length === 1) {
      this._applyPeer(peerId, data);
      return;
    }
    if (parts[1] === "offer" && data && data.sdp) this._onOffer(peerId, data.sdp);
    if (parts[1] === "phoneIce") {
      if (parts.length === 2 && data && typeof data === "object") {
        Object.entries(data).forEach(([iceId, value]) => this._onPhoneIce(peerId, iceId, value));
      } else if (parts.length === 3) this._onPhoneIce(peerId, parts[2], data);
    }
  }

  _applyPeer(peerId, node) {
    if (!PEER_RE.test(peerId) || !node || typeof node !== "object") return;
    if (node.offer && node.offer.sdp) this._onOffer(peerId, node.offer.sdp);
    if (node.phoneIce && typeof node.phoneIce === "object") {
      Object.entries(node.phoneIce).forEach(([iceId, value]) => this._onPhoneIce(peerId, iceId, value));
    }
  }

  _onOffer(peerId, sdp) {
    if (!PEER_RE.test(peerId) || this.seenOffers.has(peerId)) return;
    if (typeof sdp !== "string" || !sdp || sdp.length > 12000) return;
    this.seenOffers.add(peerId);
    this._toLink({ type: "offer", peerId, sdp });
  }

  _onPhoneIce(peerId, iceId, value) {
    if (!PEER_RE.test(peerId) || !ICE_ID_RE.test(iceId || "")) return;
    const key = `${peerId}/${iceId}`;
    if (this.seenIce.has(key)) return;
    const parsed = parseIce(value);
    if (!parsed) return;
    this.seenIce.add(key);
    this._toLink({ type: "ice", peerId, ...parsed });
  }

  _fail(err) {
    const text = err && err.message ? err.message : String(err);
    const now = Date.now();
    if (this.lastFailText === text && now - this.lastFail < 30000) return;
    this.lastFail = now;
    this.lastFailText = text;
    try { this.onError(new Error(text)); } catch (_) { /* 로그 실패는 다음 신호에서 다시 보입니다 */ }
  }

  _pause(ms) {
    if (this.stopped) return Promise.resolve();
    return new Promise((resolve) => {
      this.timer = setTimeout(() => {
        this.timer = null;
        resolve();
      }, ms);
    });
  }
}

module.exports = {
  PhoneJoin,
  publicMicUrl,
  parseIce,
  encodeIce,
};
