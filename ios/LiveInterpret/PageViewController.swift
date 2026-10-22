import AVFoundation
import UIKit
import WebKit

/// 고른 입구의 공개 페이지를 그대로 연다. 통역 계산은 이 화면이 다시 만들지 않는다.
final class LectureScanBridge: NSObject, WKScriptMessageHandler {
    weak var owner: PageViewController?
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        owner?.scanQr()
    }
}

final class PageViewController: UIViewController, WKNavigationDelegate, WKUIDelegate {
    private let page: PhonePage
    private let webView: WKWebView
    private let lectureBridge = LectureScanBridge()
    private let spinner = UIActivityIndicatorView(style: .large)
    private let errorLabel = UILabel()
    private var lectureSlot: FaceLink.LectureSlot?

    init(page: PhonePage) {
        self.page = page
        let configuration = WKWebViewConfiguration()
        configuration.allowsInlineMediaPlayback = true
        configuration.mediaTypesRequiringUserActionForPlayback = []
        configuration.defaultWebpagePreferences.allowsContentJavaScript = true
        if page == .lecture {
            configuration.userContentController.add(lectureBridge, name: "scanLecture")
        }
        webView = WKWebView(frame: .zero, configuration: configuration)
        super.init(nibName: nil, bundle: nil)
        lectureBridge.owner = self
    }

    required init?(coder: NSCoder) { nil }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = ShellColor.background
        navigationItem.title = page.title
        if page == .face || page == .lecture {
            navigationItem.rightBarButtonItem = UIBarButtonItem(
                title: "QR 스캔",
                style: .plain,
                target: self,
                action: #selector(scanQr)
            )
        }

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
        if page == .lecture {
            loadBundledLecture()
        } else {
            loadPage(page.startURL)
        }
    }

    /// 강연·회의는 앱에 넣은 입장 화면을 연다. 공개 웹의 옛 접속 번호 화면은 열지 않는다.
    private func loadBundledLecture() {
        guard let file = Bundle.main.url(forResource: "index", withExtension: "html"),
              var html = try? String(contentsOf: file, encoding: .utf8) else {
            showLoadError()
            return
        }
        html = html.replacingOccurrences(of: "<script src=\"sw-register.js\"></script>", with: "")
        errorLabel.isHidden = true
        webView.isHidden = false
        spinner.startAnimating()
        webView.loadHTMLString(html, baseURL: PhonePage.lectureDocumentBaseURL)
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        prepareMicrophone()
    }

    override var preferredStatusBarStyle: UIStatusBarStyle { .lightContent }

    /// 페이지의 마이크 요청이 시스템에 닿기 전에 재생·녹음 세션을 연다.
    private func prepareMicrophone() {
        let session = AVAudioSession.sharedInstance()
        try? session.setCategory(.playAndRecord, mode: .voiceChat, options: [.defaultToSpeaker, .allowBluetoothHFP])
        try? session.setActive(true)
    }

    private func loadPage(_ url: URL) {
        errorLabel.isHidden = true
        webView.isHidden = false
        spinner.startAnimating()
        webView.load(URLRequest(url: url))
    }

    @objc func scanQr() {
        let scanner = QrScannerViewController()
        if page == .lecture {
            scanner.hintText = "송출 컴퓨터에 나온 QR을 비추세요."
            scanner.accept = { FaceLink.lectureSlotURL(from: $0) }
        } else {
            scanner.hintText = "상대 휴대폰에 나온 QR을 비추세요."
            scanner.accept = { FaceLink.joinURL(from: $0) }
        }
        scanner.onLink = { [weak self] url in
            guard let self else { return }
            if self.page == .lecture, let slot = FaceLink.lectureSlot(from: url.absoluteString) {
                self.applyLectureScan(slot)
                return
            }
            self.loadPage(url)
        }
        let sheet = UINavigationController(rootViewController: scanner)
        sheet.modalPresentationStyle = .fullScreen
        present(sheet, animated: true)
    }

    private func applyLectureScan(_ slot: FaceLink.LectureSlot) {
        lectureSlot = slot
        let script = "window.LIJoin&&window.LIJoin.applyScan({\"connectionId\":\"\(slot.connectionId)\",\"token\":\"\(slot.token)\"})"
        webView.evaluateJavaScript(script, completionHandler: nil)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        spinner.stopAnimating()
        if let lectureSlot {
            applyLectureScan(lectureSlot)
        }
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
        if url.scheme == "about" || FaceLink.isShellPage(url) || PhonePage.isBundledLectureBase(url) {
            decisionHandler(.allow)
            return
        }
        if FaceLink.isRemoteLecturePage(url) {
            decisionHandler(.cancel)
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
