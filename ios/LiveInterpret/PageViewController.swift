import AVFoundation
import UIKit
import WebKit

/// 대면통역 페이지가 마이크를 열거나, 상대의 통역 문장이 나오면 앱에 알립니다.
final class FaceAudioBridge: NSObject, WKScriptMessageHandler {
    weak var owner: PageViewController?
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        owner?.faceAudioMessage(message.body as? String ?? "")
    }
}

/// 로그인 뒤 대면 통역 페이지만 연다. 통역 계산은 이 화면이 다시 만들지 않는다.
final class PageViewController: UIViewController, WKNavigationDelegate, WKUIDelegate {
    private let page: PhonePage
    private let webView: WKWebView
    private let faceBridge = FaceAudioBridge()
    private let faceSpeech = FaceSpeech()
    private let spinner = UIActivityIndicatorView(style: .large)
    private let errorLabel = UILabel()
    private var faceMicOpen = false
    private var micObservers: [NSObjectProtocol] = []

    init(page: PhonePage) {
        self.page = page
        let configuration = WKWebViewConfiguration()
        configuration.allowsInlineMediaPlayback = true
        configuration.mediaTypesRequiringUserActionForPlayback = []
        configuration.defaultWebpagePreferences.allowsContentJavaScript = true
        configuration.userContentController.addUserScript(WKUserScript(
            source: FaceSpeech.pageHook,
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true
        ))
        configuration.userContentController.add(faceBridge, name: "faceAudio")
        webView = WKWebView(frame: .zero, configuration: configuration)
        super.init(nibName: nil, bundle: nil)
        faceBridge.owner = self
    }

    required init?(coder: NSCoder) { nil }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = ShellColor.background
        navigationItem.title = page.title
        navigationItem.rightBarButtonItem = UIBarButtonItem(
            title: "QR 스캔",
            style: .plain,
            target: self,
            action: #selector(scanQr)
        )

        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.isOpaque = false
        webView.backgroundColor = ShellColor.background
        webView.scrollView.backgroundColor = ShellColor.background
        webView.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(webView)

        spinner.color = .white
        spinner.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(spinner)

        errorLabel.textColor = ShellColor.text
        errorLabel.numberOfLines = 0
        errorLabel.textAlignment = .center
        errorLabel.isHidden = true
        errorLabel.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(errorLabel)

        let guide = view.safeAreaLayoutGuide
        NSLayoutConstraint.activate([
            webView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            webView.topAnchor.constraint(equalTo: guide.topAnchor),
            webView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            spinner.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            spinner.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            errorLabel.leadingAnchor.constraint(equalTo: guide.leadingAnchor, constant: 24),
            errorLabel.trailingAnchor.constraint(equalTo: guide.trailingAnchor, constant: -24),
            errorLabel.centerYAnchor.constraint(equalTo: view.centerYAnchor),
        ])
        watchAudioRoute()
        loadPage(page.startURL)
    }

    deinit {
        let center = NotificationCenter.default
        micObservers.forEach { center.removeObserver($0) }
        UIApplication.shared.isIdleTimerDisabled = false
        faceSpeech.stop()
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        if presentedViewController != nil { return }
        prepareMicrophone()
    }

    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        if isMovingFromParent || isBeingDismissed {
            faceMicChanged(open: false)
            faceSpeech.stop()
        }
    }

    override var preferredStatusBarStyle: UIStatusBarStyle { .lightContent }

    /// 대면 통역 페이지의 마이크 요청이 시스템에 닿기 전에 재생·녹음 세션을 연다.
    /// 블루투스 마이크가 있으면 그 마이크를 고르고, 블루투스 출력이 있으면 스피커로 돌리지 않습니다.
    private func prepareMicrophone() {
        PhoneAudioRoute.apply(face: true, active: true)
    }

    private func watchAudioRoute() {
        micObservers.append(NotificationCenter.default.addObserver(
            forName: AVAudioSession.routeChangeNotification,
            object: AVAudioSession.sharedInstance(),
            queue: .main
        ) { [weak self] _ in
            self?.applyCurrentRoute()
        })
    }

    private func applyCurrentRoute() {
        if !PhoneAudioRoute.bluetoothOutputConnected() {
            faceSpeech.stop()
        }
        prepareMicrophone()
    }

    func faceAudioMessage(_ body: String) {
        guard let data = body.data(using: .utf8),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let event = object["event"] as? String else { return }
        if event == "mic" {
            faceMicChanged(open: (object["open"] as? Bool) == true)
            return
        }
        if event == "speak" {
            faceSpeech.speak(text: object["text"] as? String ?? "", lang: object["lang"] as? String ?? "")
        }
    }

    /// 대면통역 마이크가 켜진 동안에는 화면이 스스로 어두워지거나 잠기지 않습니다.
    private func faceMicChanged(open: Bool) {
        faceMicOpen = open
        UIApplication.shared.isIdleTimerDisabled = open
        if open {
            prepareMicrophone()
        }
    }

    private func loadPage(_ url: URL) {
        errorLabel.isHidden = true
        webView.isHidden = false
        spinner.startAnimating()
        webView.load(URLRequest(url: url))
    }

    @objc func scanQr() {
        guard presentedViewController == nil else { return }
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized:
            showScanner()
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .video) { [weak self] allowed in
                DispatchQueue.main.async {
                    guard let self else { return }
                    if allowed {
                        self.showScanner()
                    } else {
                        self.explainCameraDenied()
                    }
                }
            }
        default:
            explainCameraDenied()
        }
    }

    private func explainCameraDenied() {
        let alert = UIAlertController(
            title: "카메라가 필요합니다",
            message: "QR을 읽으려면 설정에서 이 앱의 카메라를 허용해 주세요.",
            preferredStyle: .alert
        )
        alert.addAction(UIAlertAction(title: "닫기", style: .cancel))
        alert.addAction(UIAlertAction(title: "설정 열기", style: .default) { _ in
            if let url = URL(string: UIApplication.openSettingsURLString) {
                UIApplication.shared.open(url)
            }
        })
        present(alert, animated: true)
    }

    private func showScanner() {
        guard presentedViewController == nil else { return }
        let scanner = QrScannerViewController()
        scanner.hintText = "상대 휴대폰에 나온 QR을 비추세요."
        scanner.accept = { FaceLink.joinURL(from: $0) }
        scanner.onLink = { [weak self] url, done in
            self?.loadPage(url)
            done(true)
        }
        let sheet = UINavigationController(rootViewController: scanner)
        sheet.modalPresentationStyle = .fullScreen
        sheet.isModalInPresentation = true
        present(sheet, animated: true)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        spinner.stopAnimating()
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        showLoadError()
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        showLoadError()
    }

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        guard let url = navigationAction.request.url else {
            decisionHandler(.cancel)
            return
        }
        if url.scheme == "about" || FaceLink.isShellPage(url) {
            decisionHandler(.allow)
            return
        }
        if navigationAction.targetFrame?.isMainFrame != false {
            UIApplication.shared.open(url)
        }
        decisionHandler(.cancel)
    }

    /// 페이지가 마이크나 카메라를 달라고 하면 앱 권한 창을 띄우고 허용한다.
    func webView(
        _ webView: WKWebView,
        requestMediaCapturePermissionFor origin: WKSecurityOrigin,
        initiatedByFrame frame: WKFrameInfo,
        type: WKMediaCaptureType,
        decisionHandler: @escaping (WKPermissionDecision) -> Void
    ) {
        decisionHandler(.grant)
    }

    private func showLoadError() {
        spinner.stopAnimating()
        webView.isHidden = true
        errorLabel.isHidden = false
        errorLabel.text = "페이지를 열지 못했습니다. 인터넷 연결을 확인한 뒤 다시 들어오세요."
    }
}
