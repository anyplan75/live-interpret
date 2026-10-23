import AVFoundation

/// 에어팟처럼 블루투스로 연결된 마이크와 소리 출력을 고릅니다.
/// 블루투스 마이크가 연결되어 있으면 휴대폰에 붙은 마이크를 쓰지 않습니다.
/// 블루투스 소리 출력이 연결되어 있으면 휴대폰 스피커로 돌리지 않습니다.
enum PhoneAudioRoute {
    static func bluetoothInputPort() -> AVAudioSessionPortDescription? {
        let ports = AVAudioSession.sharedInstance().availableInputs ?? []
        return ports.first { port in
            port.portType == .bluetoothHFP || port.portType == .bluetoothLE
        }
    }

    static func bluetoothOutputConnected() -> Bool {
        AVAudioSession.sharedInstance().currentRoute.outputs.contains { port in
            port.portType == .bluetoothA2DP
                || port.portType == .bluetoothHFP
                || port.portType == .bluetoothLE
        }
    }

    /// 강연·회의는 일반 모드, 대면통역은 서로 마주 보는 통화 모드를 유지합니다.
    /// 마이크를 열 때만 소리 길을 실제로 켭니다.
    static func apply(face: Bool, active: Bool) {
        let session = AVAudioSession.sharedInstance()
        let mode: AVAudioSession.Mode = face ? .voiceChat : .default
        var options: AVAudioSession.CategoryOptions = [.allowBluetoothHFP, .allowBluetoothA2DP]
        if !face {
            options.insert(.mixWithOthers)
        }
        try? session.setCategory(.playAndRecord, mode: mode, options: options)
        guard active else { return }
        try? session.setActive(true)
        if let input = bluetoothInputPort() {
            try? session.setPreferredInput(input)
        } else {
            try? session.setPreferredInput(nil)
        }
        try? session.setActive(true)
        if bluetoothInputPort() != nil || bluetoothOutputConnected() {
            try? session.overrideOutputAudioPort(.none)
            return
        }
        options.insert(.defaultToSpeaker)
        try? session.setCategory(.playAndRecord, mode: mode, options: options)
        try? session.setPreferredInput(nil)
        try? session.setActive(true)
    }
}
