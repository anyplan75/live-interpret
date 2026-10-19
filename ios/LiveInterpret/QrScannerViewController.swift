import AVFoundation
import UIKit
import Vision

/// 대면 통역에서 상대 휴대폰 화면의 QR을 읽는다. 읽은 주소는 기존 대면 페이지로 연다.
final class QrScannerViewController: UIViewController, AVCaptureVideoDataOutputSampleBufferDelegate {
    var onLink: ((URL) -> Void)?

    private let session = AVCaptureSession()
    private let sessionQueue = DispatchQueue(label: "liveinterpret.qr.session")
    private let preview = AVCaptureVideoPreviewLayer()
    private var didFinish = false

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
        preview.videoGravity = .resizeAspectFill
        preview.frame = view.bounds
        view.layer.addSublayer(preview)

        let hint = UILabel()
        hint.text = "상대 휴대폰에 나온 QR을 비추세요."
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
        askForCamera()
    }

    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        sessionQueue.async { [session] in
            if session.isRunning { session.stopRunning() }
        }
    }

    override var preferredStatusBarStyle: UIStatusBarStyle { .lightContent }

    @objc private func close() {
        dismiss(animated: true)
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
                        self?.explainDenied()
                    }
                }
            }
        default:
            explainDenied()
        }
    }

    private func explainDenied() {
        let alert = UIAlertController(
            title: "카메라가 필요합니다",
            message: "대면 통역 QR을 읽으려면 설정에서 이 앱의 카메라를 허용해 주세요.",
            preferredStyle: .alert
        )
        alert.addAction(UIAlertAction(title: "닫기", style: .cancel) { [weak self] _ in
            self?.dismiss(animated: true)
        })
        alert.addAction(UIAlertAction(title: "설정 열기", style: .default) { _ in
            if let url = URL(string: UIApplication.openSettingsURLString) {
                UIApplication.shared.open(url)
            }
        })
        present(alert, animated: true)
    }

    private func startSession() {
        sessionQueue.async { [weak self] in
            self?.configureSession()
        }
    }

    private func configureSession() {
        guard !session.isRunning else { return }
        session.beginConfiguration()
        session.sessionPreset = .high
        defer { session.commitConfiguration() }

        guard let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back),
              let input = try? AVCaptureDeviceInput(device: device),
              session.canAddInput(input) else {
            DispatchQueue.main.async { [weak self] in self?.explainDenied() }
            return
        }
        session.addInput(input)

        let output = AVCaptureVideoDataOutput()
        output.alwaysDiscardsLateVideoFrames = true
        output.setSampleBufferDelegate(self, queue: sessionQueue)
        guard session.canAddOutput(output) else { return }
        session.addOutput(output)
        orient(output.connection(with: .video))

        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            self.preview.session = self.session
            self.orient(self.preview.connection)
        }
        session.startRunning()
    }

    /// 미리보기를 세로로 맞춘다. QR 인식 자체는 방향이 달라도 된다.
    private func orient(_ connection: AVCaptureConnection?) {
        guard let connection else { return }
        if #available(iOS 17.0, *) {
            if connection.isVideoRotationAngleSupported(90) {
                connection.videoRotationAngle = 90
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
        guard !didFinish, let pixel = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
        let request = VNDetectBarcodesRequest()
        request.symbologies = [.qr]
        let handler = VNImageRequestHandler(cvPixelBuffer: pixel, orientation: .right, options: [:])
        try? handler.perform([request])
        guard let codes = request.results else { return }
        for code in codes {
            guard let raw = code.payloadStringValue, let url = FaceLink.joinURL(from: raw) else { continue }
            didFinish = true
            session.stopRunning()
            DispatchQueue.main.async { [weak self] in
                guard let self else { return }
                self.onLink?(url)
                self.dismiss(animated: true)
            }
            return
        }
    }
}
