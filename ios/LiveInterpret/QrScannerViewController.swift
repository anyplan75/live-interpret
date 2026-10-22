import AVFoundation
import UIKit

/// 송출 컴퓨터나 상대 휴대폰에 나온 QR을 읽는다.
/// 카메라는 QR을 읽거나 사람이 닫기를 누를 때까지 켜 둔다.
/// 앱 자체는 닫지 않는다. 읽은 뒤에는 이 화면만 닫고 아래 화면으로 돌아간다.
final class QrScannerViewController: UIViewController, AVCaptureMetadataOutputObjectsDelegate {
    var onLink: ((URL, @escaping (Bool) -> Void) -> Void)?
    var hintText = "QR을 비추세요."
    var accept: (String) -> URL? = { FaceLink.joinURL(from: $0) }
    /// 강연·회의는 이미 마이크용 소리 설정을 쓰고 있다. 여기서 다시 바꾸면 앱이 꺼진다.
    var keepsCurrentAudio = false

    private let session = AVCaptureSession()
    private let sessionQueue = DispatchQueue(label: "liveinterpret.qr.session")
    private let scanQueue = DispatchQueue(label: "liveinterpret.qr.scan")
    private let preview = AVCaptureVideoPreviewLayer()
    private let stateLock = NSLock()
    private var metadataOutput: AVCaptureMetadataOutput?
    private var configured = false
    private var unavailable = false
    private var didFinish = false
    private var waitingForPage = false

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        navigationItem.title = "QR 스캔"
        navigationItem.leftBarButtonItem = UIBarButtonItem(
            title: "닫기",
            style: .plain,
            target: self,
            action: #selector(close)
        )
        navigationController?.navigationBar.tintColor = .white
        let appearance = UINavigationBarAppearance()
        appearance.configureWithOpaqueBackground()
        appearance.backgroundColor = .black
        appearance.titleTextAttributes = [.foregroundColor: UIColor.white]
        navigationItem.standardAppearance = appearance
        navigationItem.scrollEdgeAppearance = appearance

        preview.videoGravity = .resizeAspectFill
        preview.frame = view.bounds
        view.layer.addSublayer(preview)

        let hint = UILabel()
        hint.text = hintText
        hint.textColor = .white
        hint.textAlignment = .center
        hint.font = .systemFont(ofSize: 16, weight: .semibold)
        hint.backgroundColor = UIColor(white: 0, alpha: 0.45)
        hint.layer.cornerRadius = 10
        hint.clipsToBounds = true
        hint.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(hint)
        let guide = view.safeAreaLayoutGuide
        NSLayoutConstraint.activate([
            hint.leadingAnchor.constraint(equalTo: guide.leadingAnchor, constant: 24),
            hint.trailingAnchor.constraint(equalTo: guide.trailingAnchor, constant: -24),
            hint.bottomAnchor.constraint(equalTo: guide.bottomAnchor, constant: -24),
            hint.heightAnchor.constraint(equalToConstant: 48),
        ])
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        preview.frame = view.bounds
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        if !keepsCurrentAudio {
            prepareCameraAudio()
        }
        askForCamera()
    }

    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        // 권한 창이 잠깐 덮는 동안에는 카메라를 끄지 않는다. 이 화면이 닫힐 때만 끈다.
        guard isBeingDismissed || isMovingFromParent else { return }
        sessionQueue.async { [weak self] in
            self?.stopSession()
        }
    }

    override var preferredStatusBarStyle: UIStatusBarStyle { .lightContent }

    @objc private func close() {
        finishAndClose()
    }

    /// 대면 통역만, 통화 모드 때문에 카메라가 바로 멈추지 않게 기본 녹음으로 되돌린다.
    /// 영상 녹화 모드와 블루투스 통화 옵션은 쓰지 않는다. 그 조합은 앱을 꺼뜨린다.
    private func prepareCameraAudio() {
        let audio = AVAudioSession.sharedInstance()
        try? audio.setCategory(.playAndRecord, mode: .default, options: [.defaultToSpeaker])
    }

    private func askForCamera() {
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized:
            startSession()
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .video) { [weak self] allowed in
                DispatchQueue.main.async {
                    if allowed {
                        self?.startSession()
                    } else {
                        self?.showCameraProblem()
                    }
                }
            }
        default:
            showCameraProblem()
        }
    }

    private func showCameraProblem() {
        let alert = UIAlertController(
            title: "카메라가 필요합니다",
            message: "QR을 읽으려면 설정에서 이 앱의 카메라를 허용해 주세요. 허용한 뒤 이 화면으로 돌아오면 카메라가 다시 열립니다.",
            preferredStyle: .alert
        )
        alert.addAction(UIAlertAction(title: "닫기", style: .cancel))
        alert.addAction(UIAlertAction(title: "설정 열기", style: .default) { _ in
            if let url = URL(string: UIApplication.openSettingsURLString) {
                UIApplication.shared.open(url)
            }
        })
        if presentedViewController == nil {
            present(alert, animated: true)
        }
    }

    private func startSession() {
        sessionQueue.async { [weak self] in
            self?.configureSession()
        }
    }

    private func configureSession() {
        if unavailable { return }
        if !configured {
            session.beginConfiguration()
            if session.canSetSessionPreset(.high) {
                session.sessionPreset = .high
            }
            let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back)
            let input = device.flatMap { try? AVCaptureDeviceInput(device: $0) }
            let output = AVCaptureMetadataOutput()
            var ready = false
            if let input, session.canAddInput(input), session.canAddOutput(output) {
                session.addInput(input)
                session.addOutput(output)
                output.setMetadataObjectsDelegate(self, queue: scanQueue)
                metadataOutput = output
                if output.availableMetadataObjectTypes.contains(.qr) {
                    output.metadataObjectTypes = [.qr]
                    ready = true
                }
            }
            session.commitConfiguration()
            if !ready, let output = metadataOutput, output.availableMetadataObjectTypes.contains(.qr) {
                session.beginConfiguration()
                output.metadataObjectTypes = [.qr]
                session.commitConfiguration()
                ready = true
            }
            guard ready else {
                unavailable = true
                DispatchQueue.main.async { [weak self] in self?.showCameraProblem() }
                return
            }
            configured = true
        }
        guard !session.isRunning else { return }
        // 카메라 켜기와 화면 붙이기를 겹치지 않는다. 겹치면 앱이 꺼진다.
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            self.preview.session = self.session
            self.sessionQueue.async { [weak self] in
                guard let self else { return }
                if !self.session.isRunning {
                    self.session.startRunning()
                }
            }
        }
    }

    private func claimCode() -> Bool {
        stateLock.lock()
        defer { stateLock.unlock() }
        if didFinish || waitingForPage { return false }
        waitingForPage = true
        return true
    }

    private func releaseCode() {
        stateLock.lock()
        waitingForPage = false
        stateLock.unlock()
    }

    private func markFinished() {
        stateLock.lock()
        didFinish = true
        waitingForPage = true
        stateLock.unlock()
    }

    /// 카메라를 끈 뒤에 이 화면만 닫는다. 앱은 아래 화면에 그대로 남는다.
    private func finishAndClose() {
        markFinished()
        sessionQueue.async { [weak self] in
            guard let self else { return }
            self.stopSession()
            DispatchQueue.main.async { [weak self] in
                guard let self else { return }
                self.preview.session = nil
                self.dismiss(animated: true)
            }
        }
    }

    private func stopSession() {
        metadataOutput?.setMetadataObjectsDelegate(nil, queue: nil)
        if session.isRunning {
            session.stopRunning()
        }
    }

    func metadataOutput(
        _ output: AVCaptureMetadataOutput,
        didOutput metadataObjects: [AVMetadataObject],
        from connection: AVCaptureConnection
    ) {
        guard claimCode() else { return }
        let raw = metadataObjects.compactMap { $0 as? AVMetadataMachineReadableCodeObject }
            .first { $0.type == .qr }?
            .stringValue
        guard let raw, let url = accept(raw) else {
            releaseCode()
            return
        }
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            guard let onLink = self.onLink else {
                self.releaseCode()
                return
            }
            onLink(url) { [weak self] accepted in
                guard let self else { return }
                if accepted {
                    self.finishAndClose()
                    return
                }
                self.releaseCode()
            }
        }
    }
}
