import AVFoundation

/// 대면통역에서 상대의 통역 문장을 듣는 사람 언어로 읽어 줍니다.
/// 블루투스 소리 출력이 연결된 동안에만 읽고, 휴대폰 스피커로는 읽지 않습니다.
final class FaceSpeech {
    private let synth = AVSpeechSynthesizer()
    private var lastText = ""
    private var lastAt = Date.distantPast

    func speak(text: String, lang: String) {
        let body = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !body.isEmpty else { return }
        PhoneAudioRoute.apply(face: true, active: true)
        let bluetoothEar = PhoneAudioRoute.bluetoothOutputConnected() || PhoneAudioRoute.bluetoothInputPort() != nil
        guard bluetoothEar else {
            stop()
            return
        }
        if body == lastText, Date().timeIntervalSince(lastAt) < 3 { return }
        lastText = body
        lastAt = Date()
        let utterance = AVSpeechUtterance(string: body)
        utterance.voice = AVSpeechSynthesisVoice(language: Self.locale(for: lang))
        synth.speak(utterance)
    }

    func stop() {
        if synth.isSpeaking {
            synth.stopSpeaking(at: .immediate)
        }
    }

    static func locale(for code: String) -> String {
        switch code {
        case "ko": return "ko-KR"
        case "en": return "en-US"
        case "ja": return "ja-JP"
        case "zh", "zh-CN": return "zh-CN"
        case "zh-TW": return "zh-TW"
        case "es": return "es-ES"
        case "fr": return "fr-FR"
        case "de": return "de-DE"
        case "pt": return "pt-BR"
        case "vi": return "vi-VN"
        case "th": return "th-TH"
        case "ru": return "ru-RU"
        case "id": return "id-ID"
        case "ne": return "ne-NP"
        case "tl": return "fil-PH"
        case "km": return "km-KH"
        case "my": return "my-MM"
        case "mn": return "mn-MN"
        case "uz": return "uz-UZ"
        case "bn": return "bn-BD"
        case "si": return "si-LK"
        default:
            return code.contains("-") ? code : "ko-KR"
        }
    }

    /// 공개 웹 페이지는 바꾸지 않습니다. 앱이 페이지 안에서만 마이크와 자막을 살펴봅니다.
    static let pageHook = """
    (function () {
      var micCount = 0;
      function post(payload) {
        var bridge = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.faceAudio;
        if (bridge) bridge.postMessage(JSON.stringify(payload));
      }
      function field(id) {
        var node = document.getElementById(id);
        return node && node.value ? String(node.value).trim() : "";
      }
      function labelFor(selectId, code) {
        var node = document.getElementById(selectId);
        if (!node || !node.options) return "";
        for (var i = 0; i < node.options.length; i += 1) {
          if (node.options[i].value === code) return (node.options[i].textContent || "").trim();
        }
        return "";
      }
      function listener() {
        var guest = document.getElementById("guest");
        if (guest && !guest.hidden) {
          var guestLang = field("guestSpoken");
          return { lang: guestLang, name: field("guestName"), label: labelFor("guestSpoken", guestLang) };
        }
        var hint = document.getElementById("speakerHint");
        if (hint && !hint.hidden) {
          var soloLang = field("soloLang0");
          return { lang: soloLang, name: field("soloName0"), label: labelFor("soloLang0", soloLang) };
        }
        var hostLang = field("hostLang");
        return { lang: hostLang, name: field("hostName"), label: labelFor("hostLang", hostLang) };
      }
      function speakOther(text, lang, speaker) {
        var who = listener();
        var line = String(text || "").trim();
        if (!line || !who.lang || who.lang !== lang) return;
        if (who.name && String(speaker || "").trim() === who.name) return;
        post({ event: "speak", text: line, lang: who.lang });
      }
      function considerHostLine(line) {
        var match = String(line || "").match(/^(.+?) → ([^:]+): ([\\s\\S]+)$/);
        if (!match) return;
        var who = listener();
        if (!who.label || match[2].trim() !== who.label) return;
        speakOther(match[3], who.lang, match[1]);
      }
      function noteCaption(event) {
        if (!event || typeof event.data !== "string") return;
        var message = null;
        try { message = JSON.parse(event.data); } catch (err) { return; }
        if (!message || message.type !== "caption") return;
        speakOther(message.text, message.lang || "", message.speaker || "");
      }
      function armMic() {
        var devices = navigator.mediaDevices;
        if (!devices || !devices.getUserMedia || devices.__liMic) return;
        devices.__liMic = true;
        var original = devices.getUserMedia.bind(devices);
        devices.getUserMedia = function (constraints) {
          return original(constraints).then(function (stream) {
            var tracks = stream.getAudioTracks ? stream.getAudioTracks() : [];
            tracks.forEach(function (track) {
              if (track.__li) return;
              track.__li = true;
              micCount += 1;
              post({ event: "mic", open: true });
              var closed = false;
              function close() {
                if (closed) return;
                closed = true;
                micCount -= 1;
                if (micCount < 0) micCount = 0;
                post({ event: "mic", open: micCount > 0 });
              }
              track.addEventListener("ended", close);
              var stop = track.stop && track.stop.bind(track);
              if (stop) track.stop = function () { close(); return stop(); };
            });
            return stream;
          });
        };
      }
      function armCaptions() {
        var board = document.getElementById("captions");
        if (!board || board.__liWatch) return;
        board.__liWatch = true;
        var last = board.textContent || "";
        var observer = new MutationObserver(function () {
          var text = board.textContent || "";
          if (text === last) return;
          var added = text.indexOf(last) === 0 ? text.slice(last.length) : text;
          last = text;
          added.split("\\n").forEach(function (line) { considerHostLine(line.trim()); });
        });
        observer.observe(board, { childList: true, characterData: true, subtree: true });
      }
      armMic();
      if (window.RTCDataChannel && RTCDataChannel.prototype) {
        var proto = RTCDataChannel.prototype;
        var desc = Object.getOwnPropertyDescriptor(proto, "onmessage");
        if (!desc || desc.configurable) {
          Object.defineProperty(proto, "onmessage", {
            configurable: true,
            enumerable: true,
            get: function () { return this.__liHandler || null; },
            set: function (fn) {
              var channel = this;
              if (typeof fn !== "function") { this.__liHandler = null; return; }
              this.__liHandler = function (event) {
                try { noteCaption(event); } catch (err) {}
                return fn.call(channel, event);
              };
            }
          });
        }
      }
      document.addEventListener("DOMContentLoaded", function () {
        armMic();
        armCaptions();
        if (document.documentElement) {
          new MutationObserver(function () { armCaptions(); }).observe(document.documentElement, { childList: true, subtree: true });
        }
      });
    })();
    """
}
