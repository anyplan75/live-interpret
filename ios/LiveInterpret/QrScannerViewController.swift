import AVFoundation
import UIKit
import Vision

/// 송출 컴퓨터나 상대 휴대폰에 나온 QR을 읽는다.
/// 카메라는 QR을 읽거나 사람이 닫기를 누를 때까지 켜 둔다.
final class QrScannerViewController: UIViewController, AVCaptureVideoDataOutputSampleBufferDelegate {
    var onLink: ((URL, @escaping (Bool) -> Void) -> Void)?
    var hintText = "QR을 비추세요."
    var accept: (String) -> URL? = { FaceLink.joinURL(from: $0) }

    private let session = AVCaptureSession()
    private let sessionQueue = DispatchQueue(label: "liveinterpret.qr.session")
    private let preview = AVCaptureVideoPreviewLayer()
    private var configured = false
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
        prepareCameraAudio()
        askForCamera()
    }

    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        // 권한 창이 잠깐 덮는 동안에는 카메라를 끄지 않는다. 이 화면이 닫힐 때만 끈다.
        guard isBeingDismissed || isMovingFromParent else { return }
        sessionQueue.async { [session] in
            if session.isRunning { session.stopRunning() }
        }
    }

    override var preferredStatusBarStyle: UIStatusBarStyle { .lightContent }

    @objc private func close() {
        dismiss(animated: true)
    }

    /// 통화용 소리 설정이 켜져 있으면 카메라가 바로 멈춘다. 스캔 동안만 영상용으로 바꾼다.
    private func prepareCameraAudio() {
        let audio = AVAudioSession.sharedInstance()
        try? audio.setCategory(.playAndRecord, mode: .videoRecording, options: [.defaultToSpeaker, .allowBluetoothHFP])
        try? audio.setActive(true)
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
        if !configured {
            session.beginConfiguration()
            if session.canSetSessionPreset(.high) {
                session.sessionPreset = .high
            }
            let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back)
            let input = device.flatMap { try? AVCaptureDeviceInput(device: $0) }
            var ready = false
            if let input, session.canAddInput(input) {
                session.addInput(input)
                let output = AVCaptureVideoDataOutput()
                output.alwaysDiscardsLateVideoFrames = true
                output.setSampleBufferDelegate(self, queue: sessionQueue)
                if session.canAddOutput(output) {
                    session.addOutput(output)
                    orient(output.connection(with: .video))
                    ready = true
                }
            }
            session.commitConfiguration()
            guard ready else {
                DispatchQueue.main.async { [weak self] in self?.showCameraProblem() }
                return
            }
            configured = true
            DispatchQueue.main.async { [weak self] in
                guard let self else { return }
                self.preview.session = self.session
                self.orient(self.preview.connection)
            }
        }
        // 설정을 끝낸 뒤에 켠다. 설정 도중에 켜면 카메라가 바로 닫힌다.
        guard !session.isRunning else { return }
        session.startRunning()
    }

    /// 미리보기를 세로로 맞춘다. QR 인식 자체는 방향이 달라도 된다.
    private func orient(_ connection: AVCaptureConnection?) {
        guard let connection else { return }
        if #available(iOS 17.0, *) {
            let angle: CGFloat = 90
            if connection.isVideoRotationAngleSupported(angle) {
                connection.videoRotationAngle = angle
            }
        } else if connection.isVideoOrientationSupported {
            connection.videoOrientation = .portrait
        }
    }

    func captureOutput(
        _ output: AVCaptureOutput,
        didOutput sampleBuffer: CMSampleBuffer,
        from connection: AVCaptureConnection
    ) {
        guard !didFinish, !waitingForPage, let pixel = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
        let request = VNDetectBarcodesRequest()
        request.symbologies = [.qr]
        let handler = VNImageRequestHandler(cvPixelBuffer: pixel, orientation: .right, options: [:])
        try? handler.perform([request])
        guard let codes = request.results else { return }
        for code in codes {
            guard let raw = code.payloadStringValue, let url = accept(raw) else { continue }
            waitingForPage = true
            DispatchQueue.main.async { [weak self] in
                guard let self else { return }
                guard let onLink = self.onLink else {
                    self.waitingForPage = false
                    return
                }
                onLink(url) { [weak self] accepted in
                    guard let self else { return }
                    if accepted {
                        self.didFinish = true
                        self.sessionQueue.async { [session] in
                            if session.isRunning { session.stopRunning() }
                        }
                        self.dismiss(animated: true)
                        return
                    }
                    self.waitingForPage = false
                }
            }
            return
        }
    }
}
