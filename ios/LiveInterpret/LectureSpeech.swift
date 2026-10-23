import AVFoundation
import Foundation
import Speech
import UIKit

/// 강연·회의 마이크가 켜져 있는 동안, 화면이 꺼져도 말을 글자로 바꿉니다.
/// 글은 송출 컴퓨터로 보내고, 화면이 꺼진 동안의 소리는 막대가 계속 움직이도록 이어서 보냅니다.
final class LectureSpeech {
    private let engine = AVAudioEngine()
    private let work = DispatchQueue(label: "lecture-speech")
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    private var recognizer: SFSpeechRecognizer?
    private var serverBase = ""
    private var localeId = "ko-KR"
    private var seq = 0
    private var lastSent = ""
    private var forwardAudio = false
    private var running = false
    private var tapped = false
    private var restarting = false
    private var pcmCarry = Data()
    var onHeard: ((String) -> Void)?

    func start(locale: String, serverBase: String) {
        let base = serverBase.trimmingCharacters(in: .whitespacesAndNewlines)
        guard base.hasPrefix("https://"), base.contains("/phoneLinks/") else { return }
        self.serverBase = base
        if !locale.isEmpty { localeId = locale }
        DispatchQueue.main.async { [weak self] in
            self?.beginEngine()
        }
        SFSpeechRecognizer.requestAuthorization { [weak self] status in
            guard status == .authorized else { return }
            DispatchQueue.main.async { self?.beginRecognition() }
        }
    }

    /// 화면이 꺼진 동안에만 소리 조각을 올립니다. 화면이 켜져 있으면 페이지가 같은 소리를 올립니다.
    func setForwardAudio(_ on: Bool) {
        forwardAudio = on
        guard running else { return }
        if on, !engine.isRunning {
            try? engine.start()
        }
    }

    func stop() {
        running = false
        forwardAudio = false
        task?.cancel()
        task = nil
        request?.endAudio()
        request = nil
        if tapped {
            engine.inputNode.removeTap(onBus: 0)
            tapped = false
        }
        engine.stop()
        pcmCarry.removeAll()
        lastSent = ""
    }

    private func beginEngine() {
        guard !serverBase.isEmpty else { return }
        if running { stop() }
        running = true
        let input = engine.inputNode
        let format = input.outputFormat(forBus: 0)
        guard format.sampleRate > 0, format.channelCount > 0 else { return }
        if tapped { input.removeTap(onBus: 0) }
        input.installTap(onBus: 0, bufferSize: 4096, format: format) { [weak self] buffer, _ in
            if let request = self?.request { request.append(buffer) }
            self?.forward(buffer)
        }
        tapped = true
        engine.prepare()
        try? engine.start()
    }

    private func beginRecognition() {
        guard running else { return }
        recognizer = SFSpeechRecognizer(locale: Locale(identifier: localeId))
        let next = SFSpeechAudioBufferRecognitionRequest()
        next.shouldReportPartialResults = true
        next.taskHint = .dictation
        request = next
        listen(next)
    }

    private func listen(_ request: SFSpeechAudioBufferRecognitionRequest) {
        task = recognizer?.recognitionTask(with: request) { [weak self] result, error in
            guard let self, self.running else { return }
            if let result, result.isFinal {
                self.publish(result.bestTranscription.formattedString)
                self.restart()
                return
            }
            if error != nil { self.restart() }
        }
    }

    private func restart() {
        guard running, !restarting else { return }
        restarting = true
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { [weak self] in
            guard let self, self.running else { return }
            self.restarting = false
            self.task = nil
            self.request?.endAudio()
            let next = SFSpeechAudioBufferRecognitionRequest()
            next.shouldReportPartialResults = true
            next.taskHint = .dictation
            self.request = next
            self.listen(next)
        }
    }

    private func publish(_ text: String) {
        let body = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !body.isEmpty, body != lastSent else { return }
        lastSent = body
        seq += 1
        let current = seq
        DispatchQueue.main.async { [weak self] in
            self?.onHeard?(body)
            self?.putLine(body, seq: current)
        }
    }

    private func forward(_ buffer: AVAudioPCMBuffer) {
        guard forwardAudio, let channels = buffer.floatChannelData else { return }
        let frames = Int(buffer.frameLength)
        let rate = buffer.format.sampleRate
        guard frames > 0, rate > 0 else { return }
        let samples = Array(UnsafeBufferPointer(start: channels[0], count: frames))
        work.async { [weak self] in
            self?.enqueuePcm(samples, rate: rate)
        }
    }

    /// 24kHz 16비트로 맞춰 1400바이트 안쪽의 조각으로 보냅니다.
    private func enqueuePcm(_ samples: [Float], rate: Double) {
        let outRate = 24000.0
        let outCount = rate == outRate ? samples.count : Int(Double(samples.count) * outRate / rate)
        guard outCount > 0 else { return }
        var pcm = Data(count: outCount * 2)
        pcm.withUnsafeMutableBytes { raw in
            guard let dest = raw.bindMemory(to: Int16.self).baseAddress else { return }
            if rate == outRate {
                for i in 0..<samples.count { dest[i] = int16Sample(samples[i]) }
                return
            }
            let ratio = rate / outRate
            var offset = 0
            for i in 0..<outCount {
                let next = min(samples.count, max(offset + 1, Int((Double(i + 1) * ratio).rounded())))
                var sum = 0.0
                var count = 0
                if offset < next {
                    for j in offset..<next {
                        sum += Double(samples[j])
                        count += 1
                    }
                }
                offset = next
                dest[i] = int16Sample(count > 0 ? Float(sum / Double(count)) : 0)
            }
        }
        pcmCarry.append(pcm)
        while pcmCarry.count >= 1280 {
            let chunk = pcmCarry.prefix(1280)
            pcmCarry.removeFirst(1280)
            putPcm(Data(chunk))
        }
    }

    private func int16Sample(_ value: Float) -> Int16 {
        let sample = max(-1, min(1, value))
        let scaled = sample < 0 ? sample * 32768 : sample * 32767
        return Int16(max(-32768, min(32767, scaled.rounded())))
    }

    private func putLine(_ text: String, seq: Int) {
        guard let url = iceURL(prefix: "line") else { return }
        put(url, ["type": "line", "text": String(text.prefix(400)), "seq": seq])
    }

    private func putPcm(_ pcm: Data) {
        guard let url = iceURL(prefix: "pcm") else { return }
        put(url, ["type": "pcm", "pcm": pcm.base64EncodedString()])
    }

    private func put(_ url: URL, _ object: [String: Any]) {
        guard let body = jsonStringBody(object) else { return }
        var request = URLRequest(url: url)
        request.httpMethod = "PUT"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = body
        let task = URLSession.shared.dataTask(with: request) { _, _, _ in }
        task.resume()
    }

    private func iceURL(prefix: String) -> URL? {
        let id = prefix + randomHex(4)
        guard (8...32).contains(id.count) else { return nil }
        return URL(string: "\(serverBase)/phoneIce/\(id).json")
    }

    private func randomHex(_ bytes: Int) -> String {
        (0..<bytes).map { _ in String(format: "%02x", UInt8.random(in: 0...255)) }.joined()
    }

    /// 서버는 이 칸에 글자 한 덩어리만 받습니다. 객체 그대로 올리면 거절됩니다.
    private func jsonStringBody(_ object: [String: Any]) -> Data? {
        guard let inner = try? JSONSerialization.data(withJSONObject: object),
              let raw = String(data: inner, encoding: .utf8) else { return nil }
        var encoded = Data([0x22])
        for byte in raw.utf8 {
            if byte == 0x22 || byte == 0x5C { encoded.append(0x5C) }
            encoded.append(byte)
        }
        encoded.append(0x22)
        return encoded
    }
}
