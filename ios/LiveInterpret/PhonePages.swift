import Foundation

/// 개인폰 앱은 대면 통역만 연다.
enum PhonePage {
    case face

    var title: String { "대면통역" }

    var startURL: URL {
        URL(string: "https://anyplan75.github.io/live-interpret/face/?app=1")!
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
    static func isShellPage(_ url: URL) -> Bool {
        guard url.scheme?.lowercased() == "https",
              url.host?.lowercased() == host else { return false }
        return isFacePath(url.path)
    }

    private static func isFacePage(_ url: URL) -> Bool {
        guard url.scheme?.lowercased() == "https",
              url.host?.lowercased() == host else { return false }
        return isFacePath(url.path)
    }

    private static func isFacePath(_ path: String) -> Bool {
        path == "/live-interpret/face" || path == "/live-interpret/face/" || path.hasPrefix("/live-interpret/face/")
    }
}
