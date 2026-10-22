import Foundation

/// 대면통역은 공개된 웹 페이지다. 강연·회의 입장 화면은 앱 안에 넣어 둔다.
enum PhonePage {
    case lecture
    case face

    var title: String {
        switch self {
        case .lecture:
            return "강연·회의"
        case .face:
            return "대면통역"
        }
    }

    var detail: String {
        switch self {
        case .lecture:
            return "휴대폰 마이크로 송출 컴퓨터에 연결합니다."
        case .face:
            return "QR을 보여 주거나, 상대 QR을 카메라로 읽습니다."
        }
    }

    var startURL: URL {
        switch self {
        case .lecture:
            return URL(string: "https://anyplan75.github.io/live-interpret/lecture/")!
        case .face:
            return URL(string: "https://anyplan75.github.io/live-interpret/face/")!
        }
    }

    /// 강연·회의 화면을 앱 안에 넣은 HTML로 열 때 쓰는 기준 주소.
    /// 공개 `/lecture/` 와 다른 경로라서, 예전에 저장된 그 페이지가 이 화면을 바꾸지 못한다.
    /// 글자 모양과 연결 스크립트는 이 주소의 상대 경로로 공개 파일을 불러 온다.
    static let lectureDocumentBaseURL = URL(string: "https://anyplan75.github.io/live-interpret/phone-booth/")!

    static func isBundledLectureBase(_ url: URL) -> Bool {
        guard url.scheme?.lowercased() == "https",
              url.host?.lowercased() == "anyplan75.github.io" else { return false }
        return url.path == "/live-interpret/phone-booth" || url.path == "/live-interpret/phone-booth/"
    }
}

enum FaceLink {
    private static let host = "anyplan75.github.io"

    /// 대면 통역 QR에 들어 있는 주소인지 확인한다. 형태는 `/face/?s=` 이다.
    static func joinURL(from raw: String) -> URL? {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let url = URL(string: trimmed), isFacePage(url) else { return nil }
        return url
    }

    /// 웹뷰가 그대로 열어도 되는 주소. 대면 통역 페이지만 해당한다.
    /// 강연·회의의 공개 주소는 옛 접속 번호 화면이라 앱 안에서 다시 열지 않는다.
    static func isShellPage(_ url: URL) -> Bool {
        guard url.scheme?.lowercased() == "https",
              url.host?.lowercased() == host else { return false }
        return isFacePath(url.path)
    }

    static func isRemoteLecturePage(_ url: URL) -> Bool {
        guard url.scheme?.lowercased() == "https",
              url.host?.lowercased() == host else { return false }
        return isLecturePath(url.path)
    }

    private static func isFacePage(_ url: URL) -> Bool {
        guard url.scheme?.lowercased() == "https",
              url.host?.lowercased() == host else { return false }
        return isFacePath(url.path)
    }

    private static func isLecturePath(_ path: String) -> Bool {
        path == "/live-interpret/lecture" || path == "/live-interpret/lecture/" || path.hasPrefix("/live-interpret/lecture/")
    }

    private static func isFacePath(_ path: String) -> Bool {
        path == "/live-interpret/face" || path == "/live-interpret/face/" || path.hasPrefix("/live-interpret/face/")
    }
}
