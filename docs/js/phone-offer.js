/**
 * 휴대폰이 보내는 WebRTC 마이크.
 * 강연·회의 앱과 대면 통역의 상대 휴대폰이 같은 신호(phoneLinks)를 씁니다.
 */
(function (root) {
  const LI = root.LI = root.LI || {};

  function randomHex(bytes) {
    const list = new Uint8Array(bytes);
    crypto.getRandomValues(list);
    return Array.from(list, (item) => item.toString(16).padStart(2, "0")).join("");
  }

  function rememberPhone(id) {
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(id || "")) return "";
    try { localStorage.setItem("liveInterpretPhoneId", id); } catch (_) { /* 저장이 막혀도 이번 연결은 유지합니다 */ }
    return id;
  }

  function storedPhone() {
    try { return localStorage.getItem("liveInterpretPhoneId") || ""; } catch (_) { return ""; }
  }

  function applySignal(link, path, data) {
    const parts = String(path || "/").split("/").filter(Boolean);
    if (!parts.length && data && typeof data === "object") {
      if (data.answer && data.answer.sdp) link.takeAnswer(data.answer.sdp);
      if (data.macIce && typeof data.macIce === "object") {
        Object.entries(data.macIce).forEach(([id, value]) => link.takeIce(id, value));
      }
      return;
    }
    if (parts[0] === "answer" && data && data.sdp) link.takeAnswer(data.sdp);
    if (parts[0] === "macIce") {
      if (parts.length === 1 && data && typeof data === "object") {
        Object.entries(data).forEach(([id, value]) => link.takeIce(id, value));
      } else if (parts.length === 2) link.takeIce(parts[1], data);
    }
  }

  function watchSignal(link, peerUrl) {
    const source = new EventSource(peerUrl);
    const onEvent = (event) => {
      let payload = null;
      try { payload = JSON.parse(event.data); } catch (_) { return; }
      if (!payload) return;
      applySignal(link, payload.path, payload.data);
    };
    source.addEventListener("put", onEvent);
    source.addEventListener("patch", onEvent);
    const timer = setInterval(async () => {
      try {
        const res = await fetch(peerUrl, { cache: "no-store" });
        if (!res.ok) return;
        applySignal(link, "/", await res.json());
      } catch (_) { /* 다음 주기에서 다시 읽습니다 */ }
    }, 1000);
    return () => {
      clearInterval(timer);
      source.close();
    };
  }

  async function putJson(url, body) {
    const res = await fetch(url, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    if (!res.ok) throw new Error("signal");
  }

  async function open(opts) {
    const options = opts || {};
    const token = options.token || "";
    const name = options.name || "";
    if (!/^[a-f0-9]{32}$/.test(token)) throw new Error("연결 토큰이 올바르지 않습니다.");
    if (!name) throw new Error("이름을 입력해 주세요.");
    const databaseURL = String(options.databaseURL || "").replace(/\/$/, "");
    const rootPath = options.rootPath || "live-interpret";
    const onStatus = options.onStatus || (() => {});
    const onJson = options.onJson || (() => {});
    const onLevel = options.onLevel || (() => {});
    let phoneId = storedPhone();
    let sending = true;
    let audioContext = options.audioContext || null;
    let mediaStream = null;
    let active = null;
    let reconnectTimer = null;
    let closed = false;
    let refused = false;
    const pin = String(options.pin || "");

    if (!audioContext) audioContext = new AudioContext();
    await audioContext.resume();
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      video: false,
    });
    const source = audioContext.createMediaStreamSource(mediaStream);
    // 출력을 0으로 두면 아이폰이 마이크 처리를 멈춰, 연결만 되고 소리가 안 간다.
    const sink = audioContext.createMediaStreamDestination();
    const sendInput = (input) => {
      let peak = 0;
      for (let i = 0; i < input.length; i += 32) {
        const value = Math.abs(input[i]);
        if (value > peak) peak = value;
      }
      onLevel(Math.max(0, Math.min(100, Math.round(peak * 140))));
      if (!sending) return;
      const current = active && active.channel;
      if (!current || current.readyState !== "open") return;
      const pcm = LI.pcm.downsampleFloatToPcm16(input, audioContext.sampleRate, 24000);
      if (!pcm.length || current.bufferedAmount > 262144) return;
      const copy = pcm.slice();
      try { current.send(copy.buffer); } catch (_) { /* 한 조각이 실패해도 다음 소리는 계속 보냅니다 */ }
    };
    const workletSource = [
      "class PcmCapture extends AudioWorkletProcessor {",
      "  process(inputs) {",
      "    const channel = inputs[0] && inputs[0][0];",
      "    if (channel && channel.length) this.port.postMessage(channel.slice(0));",
      "    return true;",
      "  }",
      "}",
      "registerProcessor('pcm-capture', PcmCapture);",
    ].join("\n");
    try {
      const workletUrl = options.workletUrl || URL.createObjectURL(new Blob([workletSource], { type: "application/javascript" }));
      await audioContext.audioWorklet.addModule(workletUrl);
      const node = new AudioWorkletNode(audioContext, "pcm-capture");
      node.port.onmessage = (audioEvent) => sendInput(audioEvent.data);
      source.connect(node);
      node.connect(sink);
    } catch (_) {
      const processor = audioContext.createScriptProcessor(4096, 1, 1);
      processor.onaudioprocess = (audioEvent) => sendInput(audioEvent.inputBuffer.getChannelData(0));
      source.connect(processor);
      processor.connect(sink);
    }

    function startLink() {
      if (closed || active) return;
      const peerId = randomHex(16);
      const base = `${databaseURL}/${rootPath}/phoneLinks/${token}/peers/${peerId}`;
      const pc = new RTCPeerConnection({
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
        bundlePolicy: "max-bundle",
      });
      const channel = pc.createDataChannel("mic");
      channel.binaryType = "arraybuffer";
      const link = {
        pc,
        channel,
        answered: false,
        iceSeen: new Set(),
        iceQueue: [],
        stopWatch: () => {},
        async takeAnswer(sdp) {
          if (this.answered || typeof sdp !== "string" || !sdp) return;
          this.answered = true;
          await pc.setRemoteDescription({ type: "answer", sdp });
          const queued = this.iceQueue.splice(0);
          for (const ice of queued) {
            try { await pc.addIceCandidate(ice); } catch (_) { /* 늦은 후보는 무시합니다 */ }
          }
        },
        takeIce(iceId, value) {
          if (this.iceSeen.has(iceId) || typeof value !== "string") return;
          let body = null;
          try { body = JSON.parse(value); } catch (_) { return; }
          if (!body || typeof body.candidate !== "string" || !body.candidate) return;
          if (/\btyp relay\b/.test(body.candidate)) return;
          this.iceSeen.add(iceId);
          const ice = {
            candidate: body.candidate,
            sdpMid: body.sdpMid || "0",
            sdpMLineIndex: Number.isInteger(body.sdpMLineIndex) ? body.sdpMLineIndex : 0,
          };
          if (!this.answered) {
            this.iceQueue.push(ice);
            return;
          }
          pc.addIceCandidate(ice).catch(() => {});
        },
      };
      active = link;
      channel.onopen = () => {
        const hello = { type: "hello", name, phoneId, pin, role: options.role || "mic" };
        if (options.spoken) hello.spoken = String(options.spoken);
        if (options.connectionId) hello.connectionId = String(options.connectionId);
        channel.send(JSON.stringify(hello));
        onStatus("연결하는 중입니다.");
      };
      channel.onmessage = (event) => {
        if (typeof event.data !== "string") return;
        let message = null;
        try { message = JSON.parse(event.data); } catch (_) { return; }
        if (!message || typeof message !== "object") return;
        if (message.type === "joined") {
          phoneId = rememberPhone(message.phoneId) || phoneId;
          onStatus("연결되었습니다.");
        } else if (message.type === "error") {
          refused = true;
          onStatus(message.message || "연결하지 못했습니다.");
          try { pc.close(); } catch (_) { /* 거절된 연결은 닫습니다 */ }
        }
        onJson(message);
      };
      channel.onclose = () => {
        if (active !== link) return;
        link.stopWatch();
        try { pc.close(); } catch (_) { /* 이미 닫힌 연결은 무시합니다 */ }
        active = null;
        if (closed || refused) return;
        onStatus("연결이 끊겼습니다. 다시 연결합니다.");
        clearTimeout(reconnectTimer);
        reconnectTimer = setTimeout(startLink, 1500);
      };
      pc.onicecandidate = (event) => {
        if (!event.candidate || !event.candidate.candidate) return;
        if (/\btyp relay\b/.test(event.candidate.candidate)) return;
        const payload = JSON.stringify({
          candidate: event.candidate.candidate,
          sdpMid: event.candidate.sdpMid,
          sdpMLineIndex: event.candidate.sdpMLineIndex,
        });
        if (payload.length > 2000) return;
        putJson(`${base}/phoneIce/${randomHex(8)}.json`, payload).catch(() => {});
      };
      link.stopWatch = watchSignal(link, `${base}.json`);
      pc.createOffer().then(async (offer) => {
        await pc.setLocalDescription(offer);
        await putJson(`${base}/offer.json`, { type: "offer", sdp: offer.sdp });
      }).catch(() => {
        onStatus("연결하지 못했습니다. 다시 시도해 주세요.");
      });
    }

    startLink();
    return {
      setPaused(next) { sending = !next; },
      stop() {
        closed = true;
        clearTimeout(reconnectTimer);
        if (active) {
          active.stopWatch();
          try { active.pc.close(); } catch (_) { /* 이미 닫힌 연결은 무시합니다 */ }
        }
        active = null;
        if (mediaStream) mediaStream.getTracks().forEach((track) => track.stop());
      },
    };
  }

  LI.phoneOffer = { open, randomHex };
})(typeof globalThis !== "undefined" ? globalThis : this);
