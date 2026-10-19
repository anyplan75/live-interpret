/**
 * 대면 통역을 연 휴대폰. 상대의 연결 신호에 답하고, 번역 문장을 데이터 채널로 보냅니다.
 * 음성 파일은 저장하지 않습니다.
 */
(function (root) {
  const LI = root.LI = root.LI || {};

  function randomHex(bytes) {
    const list = new Uint8Array(bytes);
    crypto.getRandomValues(list);
    return Array.from(list, (item) => item.toString(16).padStart(2, "0")).join("");
  }

  function parseIce(value) {
    if (typeof value !== "string") return null;
    let body = null;
    try { body = JSON.parse(value); } catch (_) { return null; }
    if (!body || typeof body.candidate !== "string" || !body.candidate) return null;
    if (/\btyp relay\b/.test(body.candidate)) return null;
    return {
      candidate: body.candidate,
      sdpMid: body.sdpMid || "0",
      sdpMLineIndex: Number.isInteger(body.sdpMLineIndex) ? body.sdpMLineIndex : 0,
    };
  }

  function start(opts) {
    const options = opts || {};
    const token = options.token || "";
    const databaseURL = String(options.databaseURL || "").replace(/\/$/, "");
    const rootPath = options.rootPath || "live-interpret";
    const peers = new Map();
    const seenOffers = new Set();
    let stopped = false;
    const base = `${databaseURL}/${rootPath}/phoneLinks/${token}`;

    async function putJson(url, body) {
      const res = await fetch(url, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        cache: "no-store",
      });
      if (!res.ok) throw new Error("signal");
    }

    function sendText(peerId, message) {
      const state = peers.get(peerId);
      if (!state) return;
      const text = JSON.stringify(message);
      if (state.channel && state.channel.readyState === "open") state.channel.send(text);
      else state.outbox.push(text);
    }

    async function takeOffer(peerId, sdp) {
      if (seenOffers.has(peerId)) return;
      if (typeof sdp !== "string" || !sdp || sdp.length > 12000) return;
      seenOffers.add(peerId);
      const pc = new RTCPeerConnection({
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
        bundlePolicy: "max-bundle",
      });
      const state = {
        pc,
        channel: null,
        outbox: [],
        iceSeen: new Set(),
        iceQueue: [],
        remoteReady: false,
      };
      peers.set(peerId, state);
      pc.onicecandidate = (event) => {
        if (!event.candidate || !event.candidate.candidate) return;
        if (/\btyp relay\b/.test(event.candidate.candidate)) return;
        const payload = JSON.stringify({
          candidate: event.candidate.candidate,
          sdpMid: event.candidate.sdpMid,
          sdpMLineIndex: event.candidate.sdpMLineIndex,
        });
        if (payload.length > 2000) return;
        putJson(`${base}/peers/${peerId}/macIce/${randomHex(8)}.json`, payload).catch(() => {});
      };
      pc.ondatachannel = (event) => {
        const channel = event.channel;
        state.channel = channel;
        channel.binaryType = "arraybuffer";
        channel.onopen = () => {
          state.outbox.forEach((text) => channel.send(text));
          state.outbox = [];
          if (options.onOpen) options.onOpen(peerId);
        };
        channel.onmessage = (message) => {
          if (typeof message.data === "string") {
            let body = null;
            try { body = JSON.parse(message.data); } catch (_) { return; }
            if (options.onText) options.onText(peerId, body);
            return;
          }
          const pcm = new Uint8Array(message.data);
          if (options.onPcm) options.onPcm(peerId, pcm);
        };
        channel.onclose = () => {
          peers.delete(peerId);
          if (options.onLeave) options.onLeave(peerId);
        };
      };
      await pc.setRemoteDescription({ type: "offer", sdp });
      state.remoteReady = true;
      const queued = state.iceQueue.splice(0);
      for (const ice of queued) {
        try { await pc.addIceCandidate(ice); } catch (_) { /* 늦은 후보는 무시합니다 */ }
      }
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await putJson(`${base}/peers/${peerId}/answer.json`, { type: "answer", sdp: answer.sdp });
    }

    function takeIce(peerId, iceId, value) {
      const state = peers.get(peerId);
      if (!state || state.iceSeen.has(iceId)) return;
      const ice = parseIce(value);
      if (!ice) return;
      state.iceSeen.add(iceId);
      if (!state.remoteReady) {
        state.iceQueue.push(ice);
        return;
      }
      state.pc.addIceCandidate(ice).catch(() => {});
    }

    async function poll() {
      if (stopped) return;
      const res = await fetch(`${base}/peers.json`, { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      if (!data || typeof data !== "object") return;
      for (const [peerId, node] of Object.entries(data)) {
        if (!/^[A-Za-z0-9_-]{8,64}$/.test(peerId) || !node || typeof node !== "object") continue;
        if (node.offer && node.offer.sdp) {
          try { await takeOffer(peerId, node.offer.sdp); } catch (_) { /* 다음 주기에서 다시 봅니다 */ }
        }
        if (node.phoneIce && typeof node.phoneIce === "object") {
          Object.entries(node.phoneIce).forEach(([iceId, value]) => takeIce(peerId, iceId, value));
        }
      }
    }

    const timer = setInterval(() => { poll().catch(() => {}); }, 700);
    poll().catch(() => {});
    return {
      sendCaption(peerId, message) { sendText(peerId, message); },
      sendAll(message) { peers.forEach((_state, peerId) => sendText(peerId, message)); },
      stop() {
        stopped = true;
        clearInterval(timer);
        peers.forEach((state) => { try { state.pc.close(); } catch (_) { /* 이미 닫힌 연결은 무시합니다 */ } });
        peers.clear();
      },
    };
  }

  LI.faceHost = { start, randomHex };
})(typeof globalThis !== "undefined" ? globalThis : this);
