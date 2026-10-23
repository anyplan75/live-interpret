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

function readServerMessage(value) {
  let text = value;
  if (text && typeof text === "object" && text.type) return text;
  if (typeof text !== "string" || !text) return null;
  let body;
  try { body = JSON.parse(text); } catch (_) { return null; }
  if (!body || typeof body !== "object" || (body.type !== "hello" && body.type !== "pcm" && body.type !== "line")) return null;
  return body;
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

function parseSseBlock(block) {
  let event = "put";
  const data = [];
  String(block || "").split("\n").forEach((line) => {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
  });
  if (!data.length) return null;
  return { event, data: data.join("\n") };
}

function asBuffer(data) {
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data);
  if (ArrayBuffer.isView(data)) return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  return Buffer.from(data);
}

function pcmFromSignal(data) {
  if (typeof data === "string") return Buffer.from(data, "base64");
  if (!data) return Buffer.alloc(0);
  return asBuffer(data);
}

class PhoneJoin {
  constructor(hooks) {
    const extra = hooks || {};
    this.onHello = extra.onHello || (() => ({ index: 0 }));
    this.onPcm = extra.onPcm || (() => {});
    this.onLine = extra.onLine || (() => {});
    this.onLeave = extra.onLeave || (() => {});
    this.onError = extra.onError || (() => {});
    this.link = null;
    this.pending = [];
    this.peers = new Map();
    this.seenOffers = new Set();
    this.offerTries = new Map();
    this.answeredPeers = new Set();
    this.seenIce = new Set();
    this.onChange = extra.onChange || (() => {});
    this.token = "";
    this.desks = [];
    this.sessionOpen = false;
    this.countChosen = false;
    this.phoneCount = 0;
    this.preparedAfterClose = [];
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
    const channels = this.desks.map((desk, slot) => ({
      slot,
      connectionId: desk.connectionId,
      pin: desk.pin,
      name: desk.name,
      showName: desk.showName !== false,
      spoken: desk.spoken,
      phoneId: desk.phoneId,
      channelIndex: desk.channelIndex,
      connected: Boolean(desk.holderPeerId),
      loginError: desk.loginError || "",
      qrDataUrl: desk.qrDataUrl || "",
    }));
    return {
      ...this.infoCache,
      ips: (this.infoCache.ips || []).slice(),
      loginError: this.loginError || "",
      channels,
    };
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
    const lectureUrl = orgServices.lectureAppUrl(catalog.pagesBase);
    const qrDataUrl = await QRCode.toDataURL(lectureUrl, { margin: 1, width: 320, errorCorrectionLevel: "M" });
    this.infoCache = {
      ...this.infoCache,
      url: lectureUrl,
      qrDataUrl,
      connectionId: "",
      pin: "",
      note: "휴대폰 앱으로 이 칸의 QR을 스캔한 뒤 이름과 말하는 언어를 입력합니다.",
    };
    if (!this.countChosen && this.desks.length === 0) this._makeDesk();
    const first = this.desks[0];
    return { connectionId: first ? first.connectionId : "", token: this.token };
  }

  /** 시작 전에 운영자가 고른 대수만큼 칸을 준비한다. 이미 만든 칸은 지우지 않고 수를 맞춘다. */
  setPhoneCount(count) {
    const n = Number(count);
    if (!Number.isInteger(n) || n < 0 || n > 8) throw new Error("휴대폰 수는 0부터 8까지입니다.");
    if (this.desks.slice(n).some((desk) => desk.holderPeerId)) {
      throw new Error("연결된 휴대폰이 있어 수를 줄일 수 없습니다.");
    }
    this.countChosen = true;
    const removed = [];
    while (this.desks.length > n) removed.push(this.desks.pop().connectionId);
    const added = [];
    while (this.desks.length < n) added.push(this._makeDesk().connectionId);
    this.phoneCount = n;
    this._notify();
    return { added, removed };
  }

  /** 칸마다 QR 그림을 만든다. 주소 안의 신호 열쇠는 그림에만 있고, 화면 글자로는 내지 않는다. */
  async refreshQrs() {
    if (!/^[a-f0-9]{32}$/.test(this.token || "")) return;
    for (const desk of this.desks) {
      const url = orgServices.lectureSlotUrl(catalog.pagesBase, desk.connectionId, this.token);
      desk.qrDataUrl = await QRCode.toDataURL(url, { margin: 1, width: 320, errorCorrectionLevel: "M" });
    }
  }

  addDesk() {
    if (!this.sessionOpen) throw new Error("방송을 시작한 뒤에 휴대폰 채널을 추가할 수 있습니다.");
    const desk = this._makeDesk();
    return { connectionId: desk.connectionId, token: this.token };
  }

  _makeDesk() {
    if (this.desks.length >= 8) throw new Error("휴대폰 입력은 8개까지입니다.");
    const connectionId = this._freshConnectionId();
    const pin = orgServices.makeSessionPin();
    const desk = {
      connectionId,
      pin,
      holderPeerId: "",
      phoneId: "",
      name: "",
      spoken: "",
      channelIndex: -1,
    };
    this.desks.push(desk);
    return desk;
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
    const count = this.countChosen ? this.phoneCount : 0;
    this.desks = [];
    this.sessionOpen = false;
    this.preparedAfterClose = [];
    if (count > 0) {
      while (this.desks.length < count) this.preparedAfterClose.push(this._makeDesk().connectionId);
    }
    this.infoCache = {
      ...this.infoCache,
      connectionId: "",
      pin: "",
      note: "설정에서 휴대폰 수를 고르면 QR이 나옵니다.",
    };
    peers.forEach((peerId) => this._toLink({ type: "close", peerId }));
    return ids;
  }

  _freshConnectionId() {
    for (let i = 0; i < 12; i += 1) {
      const connectionId = orgServices.makeConnectionId();
      if (!this.desks.some((desk) => desk.connectionId === connectionId)) return connectionId;
    }
    throw new Error("휴대폰 칸을 만들지 못했습니다. 다시 시도해 주세요.");
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
    if (!message || typeof message !== "object") return;
    if (message.type === "line") {
      this.ingestLine(peerId, message);
      return;
    }
    if (message.type !== "hello") return;
    const name = cleanDisplayName(message.name);
    const row = this._peer(peerId);
    if (!name) {
      this._refuse(peerId, "이름을 입력해 주세요.");
      return;
    }
    const connectionId = orgServices.normalizeConnectionId(message.connectionId);
    const desk = connectionId ? this.desks.find((item) => item.connectionId === connectionId) : null;
    if (!desk) {
      this._refuse(peerId, "이 QR의 칸을 찾지 못했습니다.");
      return;
    }
    const spoken = String(message.spoken || "").trim() || "ko";
    if (!catalog.langByCode[spoken]) {
      this._refuse(peerId, "말하는 언어를 선택해 주세요.", desk);
      return;
    }
    const rawPin = message.pin == null ? "" : String(message.pin).trim();
    if (rawPin && (!orgServices.validSessionPin(rawPin) || rawPin !== desk.pin)) {
      this._refuse(peerId, "이번 세션 암호가 맞지 않습니다.", desk);
      return;
    }
    const seat = orgServices.claimConnection(desk.holderPeerId, peerId);
    if (seat.replaced) this._retirePeer(seat.replaced);
    desk.holderPeerId = seat.holderPeerId;
    const requested = cleanPhoneId(message.phoneId) || crypto.randomBytes(16).toString("hex");
    row.phoneId = requested;
    desk.name = name;
    desk.spoken = spoken;
    desk.phoneId = requested;
    desk.loginError = "";
    this._notify();
    let joined;
    try {
      joined = this.onHello({ id: requested, name, spoken, connectionId }) || {};
    } catch (err) {
      row.phoneId = "";
      if (desk.holderPeerId === peerId) desk.holderPeerId = "";
      this._refuse(peerId, err.message || "연결하지 못했습니다.", desk);
      return;
    }
    this._flushEarlyPcm(peerId);
    if (joined && typeof joined.then === "function") {
      joined.then((value) => this._completeHello(peerId, desk, row, requested, name, spoken, value))
        .catch((err) => {
          this._completeHello(peerId, desk, row, requested, name, spoken, {
            name,
            phoneId: requested,
            spoken,
            loginError: err && err.message ? err.message : "연결하지 못했습니다.",
          });
        });
      return;
    }
    this._completeHello(peerId, desk, row, requested, name, spoken, joined);
  }

  /** 같은 칸으로 다시 들어온 휴대폰이 자리를 이어받습니다. 끊김으로 처리하지 않습니다. */
  _retirePeer(peerId) {
    if (!peerId) return;
    this.peers.delete(peerId);
    if (this.earlyPcm) this.earlyPcm.delete(peerId);
    if (this.earlyLines) this.earlyLines.delete(peerId);
    this._toLink({ type: "close", peerId });
  }

  _queueEarlyPcm(peerId, pcm) {
    if (!this.earlyPcm) this.earlyPcm = new Map();
    const queued = this.earlyPcm.get(peerId) || [];
    queued.push(Buffer.from(pcm));
    let total = 0;
    queued.forEach((chunk) => { total += chunk.length; });
    const cap = 24000 * 2 * 8;
    while (total > cap && queued.length) total -= queued.shift().length;
    this.earlyPcm.set(peerId, queued);
  }

  _flushEarlyPcm(peerId) {
    const queued = this.earlyPcm && this.earlyPcm.get(peerId);
    if (!queued || !queued.length) return;
    this.earlyPcm.delete(peerId);
    queued.forEach((chunk) => this.ingestPcm(peerId, chunk, "server"));
  }

  _completeHello(peerId, desk, row, requested, name, spoken, joined) {
    const accepted = joined || {};
    const phoneId = cleanPhoneId(accepted.phoneId) || requested;
    row.phoneId = phoneId;
    desk.phoneId = phoneId;
    desk.name = accepted.name || name;
    desk.spoken = accepted.spoken || spoken;
    desk.channelIndex = Number.isInteger(accepted.index) ? accepted.index : -1;
    desk.loginError = accepted.loginError || "";
    desk.showName = true;
    if (!desk.loginError) this.loginError = "";
    this._send(peerId, {
      type: "joined",
      phoneId,
      name: desk.name,
      channel: desk.channelIndex,
    });
    this._send(peerId, { type: "state", listening: !!accepted.listening });
    this._notify();
    this._flushEarlyLines(peerId);
  }

  /** 휴대폰이 알아들은 한 줄. 소리 조각 순서와 상관없이 그 글을 그대로 맥 화면에 올립니다. */
  ingestLine(peerId, message) {
    if (!PEER_RE.test(peerId || "")) return;
    const text = String(message && message.text || "").replace(/\s+/g, " ").trim().slice(0, 400);
    if (!text) return;
    const row = this.peers.get(peerId);
    if (!row || !row.phoneId) {
      if (!this.earlyLines) this.earlyLines = new Map();
      const queued = this.earlyLines.get(peerId) || [];
      queued.push(text);
      this.earlyLines.set(peerId, queued.slice(-8));
      return;
    }
    this._emitLine(row.phoneId, text);
  }

  _flushEarlyLines(peerId) {
    const queued = this.earlyLines && this.earlyLines.get(peerId);
    if (!queued || !queued.length) return;
    this.earlyLines.delete(peerId);
    const row = this.peers.get(peerId);
    if (!row || !row.phoneId) return;
    queued.forEach((text) => this._emitLine(row.phoneId, text));
  }

  _emitLine(phoneId, text) {
    const now = Date.now();
    const key = `${phoneId}\n${text}`;
    if (this.lastLineKey === key && now - (this.lastLineAt || 0) < 4000) return;
    this.lastLineKey = key;
    this.lastLineAt = now;
    try { this.onLine(phoneId, text); } catch (_) { /* 화면 갱신 실패는 다음 줄에서 다시 보입니다 */ }
  }

  ingestPcm(peerId, data, via) {
    const row = this.peers.get(peerId);
    const buf = asBuffer(data);
    const even = buf.length - (buf.length % 2);
    const pcm = even === buf.length ? buf : buf.subarray(0, even);
    if (!row || !row.phoneId) {
      if (pcm.length >= 2) this._queueEarlyPcm(peerId, pcm);
      return false;
    }
    const now = Date.now();
    // 데이터 채널(순서 그대로인 직접 통로)이 살아 있으면 서버 조각은 넣지 않습니다.
    // 서버 조각이 하나라도 왔다고 직접 통로를 막으면, 말한 순서의 소리가 사라집니다.
    if (via === "server") {
      if (row.directAudioAt && now - row.directAudioAt < 1500) return false;
    } else if (pcm.length >= 2) {
      row.directAudioAt = now;
    }
    if (pcm.length < 2) return false;
    this.onPcm(row.phoneId, pcm);
    return true;
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

  _refuse(peerId, message, desk) {
    if (desk) desk.loginError = message;
    else this.loginError = message;
    this._notify();
    this._send(peerId, { type: "error", message });
    this._toLink({ type: "close", peerId });
  }

  /** 맥에서 고친 자막 이름을 그 휴대폰 카드에 반영합니다. 휴대폰이 다시 들어오면 휴대폰에 적은 이름으로 돌아갑니다. */
  setDisplay(connectionId, patch) {
    const id = orgServices.normalizeConnectionId(connectionId);
    const desk = id ? this.desks.find((item) => item.connectionId === id) : null;
    if (!desk) return null;
    const next = patch || {};
    if (next.name) desk.name = String(next.name);
    if (Object.prototype.hasOwnProperty.call(next, "showName")) desk.showName = next.showName !== false;
    this._notify();
    return {
      connectionId: id,
      name: desk.name || "",
      showName: desk.showName !== false,
    };
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
    this.answeredPeers.add(peerId);
    await this._put(`peers/${peerId}/answer.json`, { type: "answer", sdp });
  }

  /** 답변 창이 한 번 실패해도 같은 제안은 몇 번만 다시 읽습니다. */
  forgetOffer(peerId) {
    if (!PEER_RE.test(peerId || "")) return;
    if ((this.offerTries.get(peerId) || 0) >= 3) return;
    this.seenOffers.delete(peerId);
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
    if (this.iceAbort) {
      for (const ctrl of this.iceAbort.values()) {
        try { ctrl.abort(); } catch (_) { /* 이미 끊긴 소리 줄은 무시합니다 */ }
      }
      this.iceAbort.clear();
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

  async _getSignal(suffix) {
    const res = await netFetch(this._signalUrl(suffix), {
      cache: "no-store",
      headers: { "Cache-Control": "no-cache" },
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`휴대폰 연결 신호 ${res.status}: ${text.slice(0, 160)}`);
    if (!text || text === "null") return null;
    return JSON.parse(text);
  }

  async _pollOnce() {
    if (!this.databaseURL || !this.token) return;
    const peers = await this._getSignal("peers.json?shallow=true");
    if (!peers || typeof peers !== "object") return;
    for (const peerId of Object.keys(peers)) {
      if (!PEER_RE.test(peerId)) continue;
      await this._pollPeer(peerId);
    }
  }

  /** 서버에 쌓인 가입과 소리만 새로 읽습니다. 랜 이름은 보지 않습니다. */
  async _pollPeer(peerId) {
    if (!this.seenOffers.has(peerId)) {
      const offer = await this._getSignal(`peers/${peerId}/offer.json`);
      if (offer && offer.sdp) this._onOffer(peerId, offer.sdp);
    }
    this._ensureIceWatch(peerId);
    await this._pollLines(peerId);
  }

  /** 알아들은 글만 읽습니다. 소리 조각 이름은 여기서 정렬하지 않습니다. */
  async _pollLines(peerId) {
    const ices = await this._getSignal(`peers/${peerId}/phoneIce.json?shallow=true`);
    if (!ices || typeof ices !== "object") return;
    const ids = Object.keys(ices).filter((iceId) => iceId.startsWith("line") && ICE_ID_RE.test(iceId) && !this.seenIce.has(`${peerId}/${iceId}`));
    const lines = [];
    for (const iceId of ids) {
      const value = await this._getSignal(`peers/${peerId}/phoneIce/${iceId}.json`);
      this.seenIce.add(`${peerId}/${iceId}`);
      const message = readServerMessage(value);
      if (message && message.type === "line") lines.push(message);
    }
    lines.sort((a, b) => (Number(a.seq) || 0) - (Number(b.seq) || 0));
    lines.forEach((message) => this.ingestLine(peerId, message));
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
    const attempt = (this.offerTries.get(peerId) || 0) + 1;
    this.offerTries.set(peerId, attempt);
    this._toLink({ type: "offer", peerId, sdp });
    const retry = setTimeout(() => {
      if (this.stopped || this.answeredPeers.has(peerId)) return;
      if ((this.offerTries.get(peerId) || 0) >= 3) return;
      this.seenOffers.delete(peerId);
    }, 2500);
    if (retry.unref) retry.unref();
  }

  _onPhoneIce(peerId, iceId, value) {
    if (!PEER_RE.test(peerId) || !ICE_ID_RE.test(iceId || "")) return;
    const key = `${peerId}/${iceId}`;
    if (this.seenIce.has(key) || value == null) return;
    const message = readServerMessage(value);
    if (message && message.type === "hello") {
      this.seenIce.add(key);
      this.ingestText(peerId, JSON.stringify(message));
      return;
    }
    if (message && message.type === "line") {
      this.seenIce.add(key);
      this.ingestLine(peerId, message);
      return;
    }
    if (message && message.type === "pcm") {
      const pcm = pcmFromSignal(message.pcm);
      const row = this.peers.get(peerId);
      if (!row || !row.phoneId) {
        if (pcm && pcm.length >= 2) this._queueEarlyPcm(peerId, pcm);
        this.seenIce.add(key);
        return;
      }
      if (!this.ingestPcm(peerId, pcm, "server")) {
        this.seenIce.add(key);
        return;
      }
      this.seenIce.add(key);
      return;
    }
    const parsed = parseIce(value);
    if (!parsed) {
      this.seenIce.add(key);
      return;
    }
    this.seenIce.add(key);
    this._toLink({ type: "ice", peerId, ...parsed });
  }

  /**
   * 소리 조각 이름이 말한 순서가 아니라서, 이름순으로 모아 넣으면 말이 섞입니다.
   * 서버가 새로 올리는 조각만 도착한 차례로 읽습니다. 이미 쌓인 목음은 재생하지 않습니다.
   */
  _ensureIceWatch(peerId) {
    if (!PEER_RE.test(peerId || "") || this.stopped) return;
    if (!this.iceWatch) this.iceWatch = new Set();
    if (this.iceWatch.has(peerId)) return;
    this.iceWatch.add(peerId);
    this._iceLoop(peerId).catch((err) => this._fail(err));
  }

  async _iceLoop(peerId) {
    while (!this.stopped) {
      try {
        await this._readIceStream(peerId);
      } catch (err) {
        if (this.stopped) return;
        const name = err && err.name;
        if (name === "AbortError") return;
        this._fail(err);
      }
      await this._pause(1000);
    }
  }

  _feedIceText(peerId, text) {
    let buf = String(text || "");
    let cut = buf.indexOf("\n\n");
    let rest = "";
    while (cut >= 0) {
      const raw = buf.slice(0, cut);
      buf = buf.slice(cut + 2);
      const parsed = parseSseBlock(raw);
      if (parsed) this.takeIceEvent(peerId, parsed.event, parsed.data);
      cut = buf.indexOf("\n\n");
    }
    rest = buf;
    return rest;
  }

  async _readIceStream(peerId) {
    if (!this.databaseURL || !this.token || this.stopped) return;
    const ctrl = typeof AbortController === "function" ? new AbortController() : null;
    if (ctrl) {
      if (!this.iceAbort) this.iceAbort = new Map();
      this.iceAbort.set(peerId, ctrl);
    }
    const url = this._signalUrl(`peers/${peerId}/phoneIce.json`);
    if (process.versions && process.versions.electron) {
      await this._readIceWithElectron(peerId, url, ctrl);
      return;
    }
    const res = await netFetch(url, {
      cache: "no-store",
      headers: { Accept: "text/event-stream", "Cache-Control": "no-cache" },
      signal: ctrl ? ctrl.signal : undefined,
    });
    if (!res.ok || !res.body || typeof res.body.getReader !== "function") {
      throw new Error("휴대폰 소리 줄을 열지 못했습니다.");
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    while (!this.stopped) {
      const step = await reader.read();
      if (step.done) return;
      buf += decoder.decode(step.value, { stream: true });
      buf = this._feedIceText(peerId, buf);
    }
  }

  _readIceWithElectron(peerId, url, ctrl) {
    const { net } = require("electron");
    return new Promise((resolve, reject) => {
      const req = net.request({ url, method: "GET" });
      req.setHeader("Accept", "text/event-stream");
      req.setHeader("Cache-Control", "no-cache");
      if (ctrl) ctrl.signal.addEventListener("abort", () => { try { req.abort(); } catch (_) { /* 이미 끊긴 요청은 무시합니다 */ } });
      req.on("error", reject);
      req.on("response", (res) => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error("휴대폰 소리 줄을 열지 못했습니다."));
          return;
        }
        let buf = "";
        res.on("data", (chunk) => {
          buf += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
          buf = this._feedIceText(peerId, buf);
        });
        res.on("end", resolve);
        res.on("aborted", resolve);
        res.on("error", reject);
      });
      req.end();
    });
  }

  /** 서버가 보낸 소리 줄 한 건. 새 조각은 도착 순서로 넣고, 처음 목록의 옛 소리는 넣지 않습니다. */
  takeIceEvent(peerId, eventName, dataText) {
    if (!PEER_RE.test(peerId || "")) return;
    const name = String(eventName || "put");
    if (name === "keep-alive" || name === "cancel" || name === "auth_revoked") return;
    let body = null;
    try { body = JSON.parse(String(dataText || "")); } catch (_) { return; }
    if (!body || typeof body !== "object") return;
    const path = String(body.path || "/");
    const data = body.data;
    if (path === "/") {
      this._takeIceSnapshot(peerId, data, name === "patch");
      return;
    }
    const iceId = path.split("/").filter(Boolean)[0];
    if (!iceId) return;
    this._onPhoneIce(peerId, iceId, data);
  }

  _takeIceSnapshot(peerId, data, patch) {
    if (!data || typeof data !== "object") return;
    const entries = Object.entries(data);
    const freshPcm = entries.filter(([, value]) => {
      const message = readServerMessage(value);
      return message && message.type === "pcm";
    });
    if (patch && freshPcm.length === 1 && entries.length === 1) {
      this._onPhoneIce(peerId, freshPcm[0][0], freshPcm[0][1]);
      return;
    }
    entries.forEach(([iceId, value]) => {
      const message = readServerMessage(value);
      if (message && (message.type === "pcm" || message.type === "line")) {
        this.seenIce.add(`${peerId}/${iceId}`);
        return;
      }
      this._onPhoneIce(peerId, iceId, value);
    });
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
  pcmFromSignal,
  parseSseBlock,
};
