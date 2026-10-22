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
            return "송출 컴퓨터의 QR을 스캔한 뒤 이름과 말하는 언어를 입력합니다."
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
    private static let connectionAlphabet = CharacterSet(charactersIn: "ABCDEFGHJKLMNPQRSTUVWXYZ23456789")

    struct LectureSlot {
        let connectionId: String
        let token: String
    }

    /// 대면 통역 QR에 들어 있는 주소인지 확인한다. 형태는 `/face/?s=` 이다.
    static func joinURL(from raw: String) -> URL? {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let url = URL(string: trimmed), isFacePage(url) else { return nil }
        return url
    }

    /// 강연·회의 QR. 형태는 `/lecture/?c=칸&s=신호열쇠` 이다.
    static func lectureSlot(from raw: String) -> LectureSlot? {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let url = URL(string: trimmed),
              url.scheme?.lowercased() == "https",
              url.host?.lowercased() == host else { return nil }
        let path = url.path
        let lecture = path == "/live-interpret/lecture" || path == "/live-interpret/lecture/"
        let booth = path == "/live-interpret/phone-booth" || path == "/live-interpret/phone-booth/"
        guard lecture || booth else { return nil }
        let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
        let connectionId = (items.first { $0.name == "c" }?.value ?? "").uppercased()
        let token = items.first { $0.name == "s" }?.value ?? ""
        guard isConnectionId(connectionId), isToken(token) else { return nil }
        return LectureSlot(connectionId: connectionId, token: token)
    }

    static func lectureSlotURL(from raw: String) -> URL? {
        guard lectureSlot(from: raw) != nil else { return nil }
        return URL(string: raw.trimmingCharacters(in: .whitespacesAndNewlines))
    }

    private static func isConnectionId(_ value: String) -> Bool {
        value.count == 6 && value.unicodeScalars.allSatisfy { connectionAlphabet.contains($0) }
    }

    private static func isToken(_ value: String) -> Bool {
        value.count == 32 && value.unicodeScalars.allSatisfy { ("0"..."9").contains(Character($0)) || ("a"..."f").contains(Character($0)) }
    }

    /// 웹뷰가 그대로 열어도 되는 주소. 대면 통역 페이지만 해당한다.
    /// 강연·회의 QR은 앱 안 화면으로 넘기고, 공개 웹 주소로는 다시 열지 않는다.
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
