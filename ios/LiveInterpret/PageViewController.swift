import AVFoundation
import Darwin
import UIKit
import WebKit

/// 같은 와이파이에서 이 휴대폰의 숫자 주소. 설치된 맥은 숨은 .local 이름을 찾지 못한다.
enum LocalAddress {
    static func wifiIPv4() -> String {
        var pointer: UnsafeMutablePointer<ifaddrs>?
        guard getifaddrs(&pointer) == 0, let first = pointer else { return "" }
        defer { freeifaddrs(pointer) }
        var fallback = ""
        var cursor: UnsafeMutablePointer<ifaddrs>? = first
        while let iface = cursor {
            defer { cursor = iface.pointee.ifa_next }
            let name = String(cString: iface.pointee.ifa_name)
            let flags = Int32(iface.pointee.ifa_flags)
            let up = (flags & IFF_UP) != 0
            let loopback = (flags & IFF_LOOPBACK) != 0
            guard up, !loopback, name == "en0" || name.hasPrefix("en") else { continue }
            guard let addr = iface.pointee.ifa_addr, addr.pointee.sa_family == UInt8(AF_INET) else { continue }
            var host = [CChar](repeating: 0, count: Int(NI_MAXHOST))
            if getnameinfo(addr, socklen_t(addr.pointee.sa_len), &host, socklen_t(host.count), nil, 0, NI_NUMERICHOST) != 0 {
                continue
            }
            let text = String(cString: host)
            guard text.range(of: #"^\d{1,3}(?:\.\d{1,3}){3}$"#, options: .regularExpression) != nil else { continue }
            guard text != "0.0.0.0", !text.hasPrefix("169.254.") else { continue }
            if name == "en0" { return text }
            if fallback.isEmpty { fallback = text }
        }
        return fallback
    }
}

/// 대면통역 페이지가 마이크를 열거나, 상대의 통역 문장이 나오면 앱에 알립니다.
final class FaceAudioBridge: NSObject, WKScriptMessageHandler {
    weak var owner: PageViewController?
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        owner?.faceAudioMessage(message.body as? String ?? "")
    }
}

/// 고른 입구의 공개 페이지를 그대로 연다. 통역 계산은 이 화면이 다시 만들지 않는다.
final class LectureScanBridge: NSObject, WKScriptMessageHandler {
    weak var owner: PageViewController?
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        if message.name == "lectureMic" {
            let body = message.body as? String ?? ""
            if body == "stop" {
                owner?.lectureMicStopped()
                return
            }
            if let data = body.data(using: .utf8),
               let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
               (object["event"] as? String) == "open" {
                let base = object["serverBase"] as? String ?? ""
                let locale = object["locale"] as? String ?? "ko-KR"
                owner?.lectureMicConfigured(serverBase: base, locale: locale)
                return
            }
            owner?.lectureMicOpened()
            return
        }
        owner?.scanQr()
    }
}

final class PageViewController: UIViewController, WKNavigationDelegate, WKUIDelegate {
    private let page: PhonePage
    private let webView: WKWebView
    private let lectureBridge = LectureScanBridge()
    private let faceBridge = FaceAudioBridge()
    private let faceSpeech = FaceSpeech()
    private let spinner = UIActivityIndicatorView(style: .large)
    private let errorLabel = UILabel()
    private var lectureSlot: FaceLink.LectureSlot?
    private var lectureMicOpen = false
    private var faceMicOpen = false
    private let lectureSpeech = LectureSpeech()
    private var micObservers: [NSObjectProtocol] = []

    init(page: PhonePage) {
        self.page = page
        let configuration = WKWebViewConfiguration()
        configuration.allowsInlineMediaPlayback = true
        configuration.mediaTypesRequiringUserActionForPlayback = []
        configuration.defaultWebpagePreferences.allowsContentJavaScript = true
        if page == .lecture {
            let address = LocalAddress.wifiIPv4()
            if address.range(of: #"^\d{1,3}(?:\.\d{1,3}){3}$"#, options: .regularExpression) != nil {
                configuration.userContentController.addUserScript(WKUserScript(
                    source: "window.__liLocalAddress = \"\(address)\";",
                    injectionTime: .atDocumentStart,
                    forMainFrameOnly: true
                ))
            }
            let openScanner = """
            document.addEventListener("click", function (event) {
              var node = event.target && event.target.closest ? event.target.closest("#scanQr") : null;
              if (!node) return;
              var bridge = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.scanLecture;
              if (bridge) bridge.postMessage("scan");
            }, true);
            """
            configuration.userContentController.addUserScript(WKUserScript(
                source: openScanner,
                injectionTime: .atDocumentEnd,
                forMainFrameOnly: true
            ))
            configuration.userContentController.add(lectureBridge, name: "scanLecture")
            configuration.userContentController.add(lectureBridge, name: "lectureMic")
        }
        if page == .face {
            configuration.userContentController.addUserScript(WKUserScript(
                source: FaceSpeech.pageHook,
                injectionTime: .atDocumentStart,
                forMainFrameOnly: true
            ))
            configuration.userContentController.add(faceBridge, name: "faceAudio")
        }
        webView = WKWebView(frame: .zero, configuration: configuration)
        super.init(nibName: nil, bundle: nil)
        lectureBridge.owner = self
        faceBridge.owner = self
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
        watchAudioRoute()
        if page == .lecture {
            watchLectureMic()
            loadBundledLecture()
        } else {
            loadPage(page.startURL)
        }
    }

    deinit {
        let center = NotificationCenter.default
        micObservers.forEach { center.removeObserver($0) }
        if page == .lecture || page == .face {
            UIApplication.shared.isIdleTimerDisabled = false
        }
        faceSpeech.stop()
    }

    /// 본인이 연 강연·회의 마이크만, 화면이 꺼져도 세션을 다시 살린다.
    private func watchLectureMic() {
        let center = NotificationCenter.default
        micObservers.append(center.addObserver(
            forName: UIApplication.didEnterBackgroundNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            self?.lectureSpeech.setForwardAudio(true)
            self?.resumeLectureMic()
        })
        micObservers.append(center.addObserver(
            forName: UIApplication.willEnterForegroundNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            self?.lectureSpeech.setForwardAudio(false)
        })
        micObservers.append(center.addObserver(
            forName: UIApplication.willResignActiveNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            self?.resumeLectureMic()
        })
        micObservers.append(center.addObserver(
            forName: AVAudioSession.interruptionNotification,
            object: AVAudioSession.sharedInstance(),
            queue: .main
        ) { [weak self] note in
            self?.handleAudioInterruption(note)
        })
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
        if presentedViewController != nil { return }
        if page == .lecture {
            prepareLectureSession(active: lectureMicOpen)
        } else {
            prepareMicrophone()
        }
    }

    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        if page == .lecture && (isMovingFromParent || isBeingDismissed) {
            lectureMicStopped()
        }
        if page == .face && (isMovingFromParent || isBeingDismissed) {
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

    /// 강연·회의는 음성 통화 모드를 쓰지 않는다. 그 모드는 화면이 꺼지면 마이크를 멈춘다.
    /// 블루투스 마이크가 연결되어 있으면 휴대폰 마이크 대신 그 마이크로 듣습니다.
    private func prepareLectureSession(active: Bool) {
        PhoneAudioRoute.apply(face: false, active: active)
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
        if page == .lecture {
            prepareLectureSession(active: lectureMicOpen)
            if lectureMicOpen {
                lectureSpeech.noteRouteChange()
            }
            return
        }
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

    func lectureMicOpened() {
        lectureMicOpen = true
        keepLectureScreenAwake(true)
        publishLocalAddress()
        prepareLectureSession(active: true)
    }

    /// 페이지가 연결 주소를 알려 주면, 화면이 꺼져도 그 주소로 글과 소리를 보냅니다.
    func lectureMicConfigured(serverBase: String, locale: String) {
        lectureMicOpened()
        lectureSpeech.onHeard = { [weak self] text in
            self?.deliverHeardLine(text)
        }
        lectureSpeech.start(locale: locale, serverBase: serverBase)
    }

    private func deliverHeardLine(_ text: String) {
        guard let data = try? JSONSerialization.data(withJSONObject: [text]),
              let wrapped = String(data: data, encoding: .utf8),
              wrapped.count >= 2 else { return }
        let argument = wrapped.dropFirst().dropLast()
        webView.evaluateJavaScript("window.LIJoin&&window.LIJoin.submitHeard(\(argument))")
    }

    /// 마이크를 열기 전에, 숨은 이름 대신 쓸 숫자 주소를 페이지에 알려 준다.
    private func publishLocalAddress() {
        let address = LocalAddress.wifiIPv4()
        guard address.range(of: #"^\d{1,3}(?:\.\d{1,3}){3}$"#, options: .regularExpression) != nil else { return }
        webView.evaluateJavaScript("window.LIJoin&&window.LIJoin.setLocalAddress&&window.LIJoin.setLocalAddress(\"\(address)\")")
    }

    func lectureMicStopped() {
        lectureMicOpen = false
        keepLectureScreenAwake(false)
        lectureSpeech.stop()
    }

    /// 강연·회의 마이크가 켜진 동안에는 화면이 스스로 어두워지거나 잠기지 않습니다.
    private func keepLectureScreenAwake(_ awake: Bool) {
        UIApplication.shared.isIdleTimerDisabled = awake
    }

    private func resumeLectureMic() {
        guard lectureMicOpen else { return }
        prepareLectureSession(active: true)
        lectureSpeech.setForwardAudio(UIApplication.shared.applicationState != .active)
        lectureSpeech.ensureRunning()
        webView.evaluateJavaScript("window.LIJoin&&window.LIJoin.holdMic&&window.LIJoin.holdMic()")
    }

    private func handleAudioInterruption(_ note: Notification) {
        guard lectureMicOpen else { return }
        guard
            let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
            let kind = AVAudioSession.InterruptionType(rawValue: raw),
            kind == .ended
        else { return }
        resumeLectureMic()
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
        if page == .lecture {
            scanner.keepsCurrentAudio = true
            scanner.hintText = "송출 컴퓨터에 나온 QR을 비추세요."
            scanner.accept = { FaceLink.lectureSlotURL(from: $0) }
        } else {
            scanner.hintText = "상대 휴대폰에 나온 QR을 비추세요."
            scanner.accept = { FaceLink.joinURL(from: $0) }
        }
        scanner.onLink = { [weak self] url, done in
            guard let self else {
                done(false)
                return
            }
            if self.page == .lecture, let slot = FaceLink.lectureSlot(from: url.absoluteString) {
                self.lectureSlot = slot
                self.applyLectureScan(slot, done: done)
                return
            }
            self.loadPage(url)
            done(true)
        }
        let sheet = UINavigationController(rootViewController: scanner)
        sheet.modalPresentationStyle = .fullScreen
        sheet.isModalInPresentation = true
        present(sheet, animated: true)
    }

    private func applyLectureScan(_ slot: FaceLink.LectureSlot, done: ((Bool) -> Void)? = nil) {
        lectureSlot = slot
        let script = "window.LIJoin&&window.LIJoin.applyScan({\"connectionId\":\"\(slot.connectionId)\",\"token\":\"\(slot.token)\"})"
        webView.evaluateJavaScript(script) { result, _ in
            let accepted = (result as? Bool) == true || (result as? NSNumber)?.boolValue == true
            done?(accepted)
        }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        spinner.stopAnimating()
        if page == .lecture {
            publishLocalAddress()
        }
        if let lectureSlot {
            applyLectureScan(lectureSlot) { [weak self] accepted in
                guard accepted, let self, self.presentedViewController != nil else { return }
                self.dismiss(animated: true)
            }
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
