import Foundation

/// 강연·회의와 대면통역은 이미 공개된 웹 페이지다. 이 앱은 그 페이지를 여는 입구만 맡는다.
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
}

enum FaceLink {
    private static let host = "anyplan75.github.io"

    /// 대면 통역 QR에 들어 있는 주소인지 확인한다. 형태는 `/face/?s=` 이다.
    static func joinURL(from raw: String) -> URL? {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let url = URL(string: trimmed), isFacePage(url) else { return nil }
        return url
    }

    /// 웹뷰가 열어도 되는 주소. 통역 페이지 두 곳만 앱 안에 둔다.
    static func isShellPage(_ url: URL) -> Bool {
        guard url.scheme?.lowercased() == "https",
              url.host?.lowercased() == host else { return false }
        return isLecturePath(url.path) || isFacePath(url.path)
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
