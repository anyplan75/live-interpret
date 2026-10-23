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
    private var listenGeneration = 0
    private var pcmCarry = Data()
    private var pendingText = ""
    private var silenceItem: DispatchWorkItem?
    private var backgroundTask = UIBackgroundTaskIdentifier.invalid
    /// 웹 페이지가 한 문장을 끊는 길이와 같게, 말이 잠깐 멈추면 그 문장을 보냅니다.
    private let sentencePause: TimeInterval = 0.8
    var onHeard: ((String) -> Void)?

    func start(locale: String, serverBase: String) {
        let base = serverBase.trimmingCharacters(in: .whitespacesAndNewlines)
        guard base.hasPrefix("https://"), base.contains("/phoneLinks/") else { return }
        self.serverBase = base
        if !locale.isEmpty { localeId = locale }
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            if self.running { self.stop() }
            self.beginEngine()
        }
        SFSpeechRecognizer.requestAuthorization { [weak self] status in
            guard status == .authorized else { return }
            DispatchQueue.main.async {
                guard let self, self.running, self.request == nil else { return }
                self.beginRecognition()
            }
        }
    }

    /// 화면이 꺼진 동안에만 소리 조각을 올립니다. 화면이 켜져 있으면 페이지가 같은 소리를 올립니다.
    func setForwardAudio(_ on: Bool) {
        forwardAudio = on
        guard running else { return }
        if on {
            holdBackground()
            ensureRunning()
        } else {
            endBackground()
        }
    }

    /// 화면이 꺼져 듣기가 끊기면 마이크와 문장 듣기를 다시 엽니다.
    func ensureRunning() {
        guard running, !serverBase.isEmpty else { return }
        if !tapped || !engine.isRunning {
            beginEngine()
        }
        if task?.state != .running {
            restart()
        }
    }

    func stop() {
        running = false
        listenGeneration += 1
        restarting = false
        forwardAudio = false
        silenceItem?.cancel()
        silenceItem = nil
        pendingText = ""
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
        endBackground()
    }

    private func beginEngine() {
        guard !serverBase.isEmpty else { return }
        running = true
        let input = engine.inputNode
        let format = input.outputFormat(forBus: 0)
        guard format.sampleRate > 0, format.channelCount > 0 else { return }
        if tapped { input.removeTap(onBus: 0); tapped = false }
        input.installTap(onBus: 0, bufferSize: 4096, format: format) { [weak self] buffer, _ in
            if let request = self?.request { request.append(buffer) }
            self?.forward(buffer)
        }
        tapped = true
        engine.prepare()
        if !engine.isRunning {
            try? engine.start()
        }
    }

    private func beginRecognition() {
        guard running else { return }
        recognizer = SFSpeechRecognizer(locale: Locale(identifier: localeId))
        let next = makeRequest()
        request = next
        listen(next)
    }

    private func makeRequest() -> SFSpeechAudioBufferRecognitionRequest {
        let next = SFSpeechAudioBufferRecognitionRequest()
        next.shouldReportPartialResults = true
        next.taskHint = .dictation
        if recognizer?.supportsOnDeviceRecognition == true {
            next.requiresOnDeviceRecognition = true
        }
        if #available(iOS 16.0, *) {
            next.addsPunctuation = true
        }
        return next
    }

    private func listen(_ request: SFSpeechAudioBufferRecognitionRequest) {
        task = recognizer?.recognitionTask(with: request) { [weak self] result, error in
            guard let self, self.running else { return }
            if let result {
                let text = self.normalized(result.bestTranscription.formattedString)
                let finished = result.isFinal
                DispatchQueue.main.async {
                    self.note(text, isFinal: finished)
                }
            }
            if let error, !self.causedByRestart(error) {
                DispatchQueue.main.async {
                    guard self.running, !self.restarting else { return }
                    self.finishPending()
                }
            }
        }
    }

    /// 애플은 듣기를 끄기 전에는 문장 끝을 알려 주지 않습니다. 웹 페이지처럼 말이 멈추면 그 문장을 보냅니다.
    private func note(_ text: String, isFinal: Bool) {
        guard running, !restarting else { return }
        if isFinal {
            silenceItem?.cancel()
            pendingText = ""
            publish(text)
            restart()
            return
        }
        guard !text.isEmpty, text != pendingText else { return }
        pendingText = text
        silenceItem?.cancel()
        let item = DispatchWorkItem { [weak self] in
            self?.finishPending()
        }
        silenceItem = item
        DispatchQueue.main.asyncAfter(deadline: .now() + sentencePause, execute: item)
    }

    private func finishPending() {
        silenceItem?.cancel()
        let text = pendingText
        pendingText = ""
        if !text.isEmpty { publish(text) }
        restart()
    }

    private func normalized(_ text: String) -> String {
        text.replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private func causedByRestart(_ error: Error) -> Bool {
        let ns = error as NSError
        return ns.domain == "kAFAssistantErrorDomain" && (ns.code == 216 || ns.code == 301)
    }

    private func restart() {
        guard running, !restarting else { return }
        restarting = true
        silenceItem?.cancel()
        pendingText = ""
        task?.cancel()
        task = nil
        let generation = listenGeneration
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { [weak self] in
            guard let self, self.running, self.listenGeneration == generation else { return }
            self.restarting = false
            self.request?.endAudio()
            if self.recognizer == nil {
                self.recognizer = SFSpeechRecognizer(locale: Locale(identifier: self.localeId))
            }
            let next = self.makeRequest()
            self.request = next
            self.listen(next)
        }
    }

    private func publish(_ text: String) {
        let body = normalized(String(text.prefix(400)))
        guard !body.isEmpty, body != lastSent else { return }
        lastSent = body
        seq += 1
        let current = seq
        onHeard?(body)
        putLine(body, seq: current)
    }

    private func holdBackground() {
        guard backgroundTask == .invalid else { return }
        backgroundTask = UIApplication.shared.beginBackgroundTask(withName: "lecture-mic") { [weak self] in
            self?.endBackground()
        }
    }

    private func endBackground() {
        guard backgroundTask != .invalid else { return }
        let task = backgroundTask
        backgroundTask = .invalid
        UIApplication.shared.endBackgroundTask(task)
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
