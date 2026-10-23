import Foundation
import Security

/// 사람이 보는 오류 문장. 개발자용 영어 포장과 호출 기록은 뺍니다.
struct OperatorMessage: Error {
    let text: String
}

/// 운영 계정 화면에서 보여주는 계정 한 줄.
struct OperatorAccount {
    let id: String
    let name: String
    let balanceLabel: String
    let timeLabel: String
    let recentLabel: String
}

/// 개인폰의 계정 사용 화면.
/// 비밀번호는 여기 적지 않습니다. 로그인할 때 입력한 값만 서버로 보내고, 앱에는 다시 로그인할 표식만 남깁니다.
final class PhoneOperator {
    static let operatorEmail = "anyplan@me.com"
    private static let databaseURL = "https://live-interpret-db65e-default-rtdb.asia-southeast1.firebasedatabase.app"
    private static let rootPath = "live-interpret"

    let email: String
    let localId: String
    private var idToken: String
    private var refreshToken: String
    private var expiresAt: Date

    private init(email: String, localId: String, idToken: String, refreshToken: String, expiresAt: Date) {
        self.email = email
        self.localId = localId
        self.idToken = idToken
        self.refreshToken = refreshToken
        self.expiresAt = expiresAt
    }

    static func isOperatorEmail(_ email: String) -> Bool {
        email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() == operatorEmail
    }

    static func isOperatorAccount(email: String, localId: String, adminUid: String) -> Bool {
        guard isOperatorEmail(email), !adminUid.isEmpty, localId == adminUid else { return false }
        return true
    }

    static func parsedAmount(_ raw: String) -> Int {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, let number = Double(trimmed) else { return 0 }
        return Int(number.rounded())
    }

    static func userFacing(_ value: String) -> String {
        if value.trimmingCharacters(in: .whitespacesAndNewlines) == "충전할 금액을 적으세요" {
            return "충전할 금액을 적으세요"
        }
        let pieces = value.replacingOccurrences(of: "\r", with: "\n").split(separator: "\n", omittingEmptySubsequences: false).compactMap { raw -> String? in
            let line = raw.trimmingCharacters(in: .whitespaces)
            if line.isEmpty || line.range(of: #"^at\s+\S"#, options: .regularExpression) != nil { return nil }
            return line
        }
        var body = pieces.joined(separator: " ").trimmingCharacters(in: .whitespacesAndNewlines)
        for _ in 0..<6 {
            var next = body
            let patterns = [
                #"^Uncaught \(in promise\)\s+"#,
                #"^Error:\s+"#,
                #"^Error invoking remote method ['"][^'"]+['"]:\s*"#,
                #"^Error occurred in handler for ['"][^'"]+['"]:\s*"#,
            ]
            var changed = false
            for pattern in patterns {
                if let range = next.range(of: pattern, options: .regularExpression) {
                    next.removeSubrange(range)
                    next = next.trimmingCharacters(in: .whitespacesAndNewlines)
                    changed = true
                }
            }
            if !changed { break }
            body = next
        }
        if body.range(of: #"Error invoking remote method|Error occurred in handler"#, options: [.regularExpression, .caseInsensitive]) != nil {
            if let range = body.range(of: #"[가-힣].*"#, options: .regularExpression) {
                body = String(body[range]).trimmingCharacters(in: .whitespacesAndNewlines)
            } else {
                body = ""
            }
        }
        if body.isEmpty { return "다시 시도해 주세요." }
        if body.range(of: #"firebase\s+401|permission denied"#, options: [.regularExpression, .caseInsensitive]) != nil {
            return "저장할 권한이 없습니다. 다시 로그인한 뒤 한 번 더 시도해 주세요."
        }
        if body.range(of: #"\bFirebase\b|\bNSError\b|NSURLError|https?://"#, options: [.regularExpression, .caseInsensitive]) != nil {
            return "다시 시도해 주세요."
        }
        return body
    }

    static func userFacing(_ error: Error) -> String {
        if let message = error as? OperatorMessage { return userFacing(message.text) }
        if error is URLError { return "네트워크에 연결하지 못했습니다." }
        return userFacing(String(describing: error))
    }

    static func signIn(email rawEmail: String, secret: String) async throws -> PhoneOperator {
        let email = rawEmail.trimmingCharacters(in: .whitespacesAndNewlines)
        guard validEmail(email), secret.count >= 6, secret.count <= 200 else {
            throw OperatorMessage(text: "이메일과 비밀번호를 확인해 주세요. 비밀번호는 6자 이상입니다.")
        }
        let session = try await requestIdentity(email: email, secret: secret)
        let adminUid = try await readAdminUid(idToken: session.idToken)
        guard isOperatorAccount(email: session.email, localId: session.localId, adminUid: adminUid) else {
            throw OperatorMessage(text: "이 계정은 운영 화면을 열 수 없습니다.")
        }
        let operatorSession = PhoneOperator(
            email: session.email,
            localId: session.localId,
            idToken: session.idToken,
            refreshToken: session.refreshToken,
            expiresAt: Date().addingTimeInterval(session.expiresIn)
        )
        OperatorKeychain.save(refreshToken: session.refreshToken, email: session.email, localId: session.localId)
        return operatorSession
    }

    static func restore() async -> PhoneOperator? {
        guard let saved = OperatorKeychain.load() else { return nil }
        guard isOperatorEmail(saved.email), !saved.localId.isEmpty, !saved.refreshToken.isEmpty else {
            OperatorKeychain.clear()
            return nil
        }
        do {
            let refreshed = try await refreshIdentity(refreshToken: saved.refreshToken)
            let adminUid = try await readAdminUid(idToken: refreshed.idToken)
            guard isOperatorAccount(email: saved.email, localId: refreshed.localId.isEmpty ? saved.localId : refreshed.localId, adminUid: adminUid) else {
                OperatorKeychain.clear()
                return nil
            }
            let localId = refreshed.localId.isEmpty ? saved.localId : refreshed.localId
            OperatorKeychain.save(refreshToken: refreshed.refreshToken, email: saved.email, localId: localId)
            return PhoneOperator(
                email: saved.email,
                localId: localId,
                idToken: refreshed.idToken,
                refreshToken: refreshed.refreshToken,
                expiresAt: Date().addingTimeInterval(refreshed.expiresIn)
            )
        } catch {
            OperatorKeychain.clear()
            return nil
        }
    }

    func signOut() {
        OperatorKeychain.clear()
        idToken = ""
        refreshToken = ""
    }

    func listAccounts() async throws -> [OperatorAccount] {
        try await ensureOperator()
        let index = try await getJSON("churchIndex") as? [String: Any] ?? [:]
        var rows: [OperatorAccount] = []
        for (id, value) in index {
            guard Self.isAccountId(id), let row = value as? [String: Any] else { continue }
            let billing = try await getJSON("churches/\(id)/billing") as? [String: Any]
            let usage = try await getJSON("churches/\(id)/live/usage") as? [String: Any]
            let sessions = try await getJSON("churches/\(id)/sessionIndex") as? [String: Any]
            rows.append(Self.accountRow(id: id, indexRow: row, billing: billing, usage: usage, sessionIndex: sessions))
        }
        return rows.sorted { $0.name.localizedCompare($1.name) == .orderedAscending }
    }

    func addCredit(accountId: String, amount: Int) async throws -> String {
        try await ensureOperator()
        guard Self.isAccountId(accountId) else {
            throw OperatorMessage(text: "계정을 골라 주세요.")
        }
        guard amount > 0 else {
            throw OperatorMessage(text: "충전할 금액을 적으세요")
        }
        let index = try await getJSON("churchIndex") as? [String: Any] ?? [:]
        guard index[accountId] != nil else {
            throw OperatorMessage(text: "계정을 찾지 못했습니다.")
        }
        let billing = try await getJSON("churches/\(accountId)/billing") as? [String: Any] ?? [:]
        let balance = Self.intValue(billing["balance"])
        let next = balance + amount
        let entryId = "e\(Int(Date().timeIntervalSince1970 * 1000))_\(UUID().uuidString.prefix(6).lowercased())"
        let row: [String: Any] = [
            "type": "manual",
            "deltaKrw": amount,
            "amountKrw": amount,
            "balanceAfter": next,
            "at": Int(Date().timeIntervalSince1970 * 1000),
            "who": localId,
            "note": "선불 잔액",
            "depositId": "",
            "churchId": accountId,
        ]
        let patch: [String: Any] = [
            "balance": next,
            "lastEntryId": entryId,
            "ledger/\(entryId)": row,
        ]
        try await patchJSON("churches/\(accountId)/billing", body: patch)
        return Self.formatKrw(next)
    }

    func testPeriodOn() async throws -> Bool {
        try await ensureOperator()
        let value = try await getJSON("billing/testPeriod")
        if value is NSNull { return false }
        if let flag = value as? Bool { return flag }
        if let number = value as? NSNumber { return number.boolValue }
        return false
    }

    func setTestPeriod(_ on: Bool) async throws -> Bool {
        try await ensureOperator()
        try await putJSON("billing/testPeriod", body: Data((on ? "true" : "false").utf8))
        return on
    }

    private func ensureOperator() async throws {
        try await refreshIfNeeded()
        let adminUid = try await Self.readAdminUid(idToken: idToken)
        guard Self.isOperatorAccount(email: email, localId: localId, adminUid: adminUid) else {
            signOut()
            throw OperatorMessage(text: "이 계정은 운영 화면을 열 수 없습니다.")
        }
    }

    private func refreshIfNeeded() async throws {
        guard Date() > expiresAt.addingTimeInterval(-60) else { return }
        let refreshed = try await Self.refreshIdentity(refreshToken: refreshToken)
        idToken = refreshed.idToken
        refreshToken = refreshed.refreshToken
        expiresAt = Date().addingTimeInterval(refreshed.expiresIn)
        OperatorKeychain.save(refreshToken: refreshToken, email: email, localId: localId)
    }

    private static func accountRow(id: String, indexRow: [String: Any], billing: [String: Any]?, usage: [String: Any]?, sessionIndex: [String: Any]?) -> OperatorAccount {
        let named = (indexRow["name"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let name = named.isEmpty ? id : named
        let balance = intValue(billing?["balance"])
        let remaining = remainingSeconds(billing?["prepaid"] as? [String: Any])
        return OperatorAccount(
            id: id,
            name: name,
            balanceLabel: formatKrw(balance),
            timeLabel: remaining > 0 ? "남은 시간 \(formatClock(remaining))" : "남은 시간 없음",
            recentLabel: recentUse(usage: usage, sessionIndex: sessionIndex)
        )
    }

    private static func remainingSeconds(_ prepaid: [String: Any]?) -> Int {
        guard let prepaid else { return 0 }
        let remaining = intValue(prepaid["remainingSeconds"])
        let key = (prepaid["languageKey"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let languages = prepaid["languages"]
        let hasLanguages = !key.isEmpty || (languages as? [Any])?.isEmpty == false || (languages as? [String: Any])?.isEmpty == false
        let kind = prepaid["kind"] as? String ?? ""
        let amount = intValue(prepaid["amountKrw"])
        guard remaining > 0, hasLanguages, (kind == "hour" || kind == "half"), amount >= 0 else { return 0 }
        return remaining
    }

    private static func recentUse(usage: [String: Any]?, sessionIndex: [String: Any]?) -> String {
        let liveAt = intValue(usage?["updatedAt"])
        let live: [String: Int]? = liveAt > 0 ? [
            "at": liveAt,
            "audioSeconds": max(0, intValue(usage?["audioSeconds"])),
            "churchKrw": intValue(usage?["churchKrw"]),
        ] : nil
        var saved: [String: Int]?
        if let sessionIndex {
            for value in sessionIndex.values {
                guard let row = value as? [String: Any] else { continue }
                let at = max(intValue(row["endedAt"]), intValue(row["startedAt"]))
                guard at > 0 else { continue }
                if saved == nil || at > (saved?["at"] ?? 0) {
                    saved = [
                        "at": at,
                        "audioSeconds": max(0, intValue(row["audioSeconds"])),
                        "churchKrw": intValue(row["churchKrw"]),
                    ]
                }
            }
        }
        let picked: [String: Int]?
        if live == nil { picked = saved }
        else if saved == nil { picked = live }
        else { picked = (live?["at"] ?? 0) >= (saved?["at"] ?? 0) ? live : saved }
        guard let picked else { return "최근 사용 없음" }
        var parts = [stamp(picked["at"] ?? 0)]
        if (picked["audioSeconds"] ?? 0) > 0 { parts.append(formatClock(picked["audioSeconds"] ?? 0)) }
        if (picked["churchKrw"] ?? 0) != 0 { parts.append(formatKrw(picked["churchKrw"] ?? 0)) }
        return parts.joined(separator: " · ")
    }

    private static func stamp(_ at: Int) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd HH:mm"
        return formatter.string(from: Date(timeIntervalSince1970: TimeInterval(at) / 1000))
    }

    static func formatKrw(_ value: Int) -> String {
        let sign = value < 0 ? "-" : ""
        let digits = String(abs(value))
        var grouped = ""
        for (offset, character) in digits.reversed().enumerated() {
            if offset > 0, offset % 3 == 0 { grouped = "," + grouped }
            grouped = String(character) + grouped
        }
        return "\(sign)\(grouped)원"
    }

    private static func formatClock(_ seconds: Int) -> String {
        let total = max(0, seconds)
        return "\(total / 60):" + String(format: "%02d", total % 60)
    }

    private static func isAccountId(_ id: String) -> Bool {
        guard (1...64).contains(id.count) else { return false }
        let banned: Set<String> = ["cheil", "jifc"]
        if banned.contains(id.lowercased()) { return false }
        let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "_-"))
        return id.unicodeScalars.allSatisfy { allowed.contains($0) }
    }

    private static func intValue(_ value: Any?) -> Int {
        if let number = value as? Int { return number }
        if let number = value as? Double { return Int(number.rounded()) }
        if let number = value as? NSNumber { return number.intValue }
        if let text = value as? String, let number = Double(text) { return Int(number.rounded()) }
        return 0
    }

    private static func validEmail(_ email: String) -> Bool {
        let pattern = #"^[^\s@]+@[^\s@]+\.[^\s@]+$"#
        return email.range(of: pattern, options: .regularExpression) != nil
    }

    private struct IdentitySession {
        let idToken: String
        let refreshToken: String
        let localId: String
        let email: String
        let expiresIn: TimeInterval
    }

    private static func clientKey() throws -> String {
        guard let url = Bundle.main.url(forResource: "phone-firebase-env", withExtension: "js"),
              let text = try? String(contentsOf: url, encoding: .utf8),
              let marker = text.range(of: "FIREBASE_API_KEY") else {
            throw OperatorMessage(text: "다시 시도해 주세요.")
        }
        let rest = text[marker.upperBound...]
        guard let open = rest.firstIndex(of: "\""),
              let close = rest[rest.index(after: open)...].firstIndex(of: "\"") else {
            throw OperatorMessage(text: "다시 시도해 주세요.")
        }
        let key = String(rest[rest.index(after: open)..<close]).trimmingCharacters(in: .whitespacesAndNewlines)
        guard !key.isEmpty else { throw OperatorMessage(text: "다시 시도해 주세요.") }
        return key
    }

    private static func requestIdentity(email: String, secret: String) async throws -> IdentitySession {
        let key = try clientKey()
        guard let url = URL(string: "https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=\(key.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? "")") else {
            throw OperatorMessage(text: "다시 시도해 주세요.")
        }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: [
            "email": email,
            "password": secret,
            "returnSecureToken": true,
        ])
        let data = try await send(request)
        guard let object = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let idToken = object["idToken"] as? String, !idToken.isEmpty,
              let refreshToken = object["refreshToken"] as? String, !refreshToken.isEmpty else {
            throw OperatorMessage(text: "로그인 응답이 올바르지 않습니다.")
        }
        let expires = TimeInterval(intValue(object["expiresIn"]))
        return IdentitySession(
            idToken: idToken,
            refreshToken: refreshToken,
            localId: object["localId"] as? String ?? "",
            email: (object["email"] as? String) ?? email,
            expiresIn: expires > 0 ? expires : 3600
        )
    }

    private static func refreshIdentity(refreshToken: String) async throws -> IdentitySession {
        let key = try clientKey()
        guard let url = URL(string: "https://securetoken.googleapis.com/v1/token?key=\(key.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? "")") else {
            throw OperatorMessage(text: "다시 시도해 주세요.")
        }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        let token = refreshToken.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? ""
        request.httpBody = "grant_type=refresh_token&refresh_token=\(token)".data(using: .utf8)
        let data = try await send(request)
        guard let object = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let idToken = object["id_token"] as? String, !idToken.isEmpty else {
            throw OperatorMessage(text: "로그인 세션을 갱신하지 못했습니다.")
        }
        let expires = TimeInterval(intValue(object["expires_in"]))
        return IdentitySession(
            idToken: idToken,
            refreshToken: (object["refresh_token"] as? String) ?? refreshToken,
            localId: object["user_id"] as? String ?? "",
            email: "",
            expiresIn: expires > 0 ? expires : 3600
        )
    }

    private static func readAdminUid(idToken: String) async throws -> String {
        let value = try await getJSON("admin/uid", idToken: idToken)
        return value as? String ?? ""
    }

    private func getJSON(_ path: String) async throws -> Any? {
        try await refreshIfNeeded()
        return try await Self.getJSON(path, idToken: idToken)
    }

    private static func getJSON(_ path: String, idToken: String) async throws -> Any? {
        var request = URLRequest(url: try databaseURL(path, idToken: idToken))
        request.httpMethod = "GET"
        let data = try await send(request)
        if data.isEmpty { return nil }
        return try JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed])
    }

    private func patchJSON(_ path: String, body: [String: Any]) async throws {
        try await refreshIfNeeded()
        var request = URLRequest(url: try Self.databaseURL(path, idToken: idToken))
        request.httpMethod = "PATCH"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        _ = try await Self.send(request)
    }

    private func putJSON(_ path: String, body: Data) async throws {
        try await refreshIfNeeded()
        var request = URLRequest(url: try Self.databaseURL(path, idToken: idToken))
        request.httpMethod = "PUT"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = body
        _ = try await Self.send(request)
    }

    private static func databaseURL(_ path: String, idToken: String) throws -> URL {
        let clean = path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        let auth = idToken.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? ""
        let raw = "\(databaseURL)/\(rootPath)/\(clean).json?auth=\(auth)"
        guard let url = URL(string: raw) else { throw OperatorMessage(text: "다시 시도해 주세요.") }
        return url
    }

    private static func send(_ request: URLRequest) async throws -> Data {
        let (data, response) = try await URLSession.shared.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200...299).contains(status) else {
            let body = String(data: data, encoding: .utf8) ?? ""
            if status == 401 || status == 403 || body.range(of: "Permission denied", options: .caseInsensitive) != nil {
                throw OperatorMessage(text: "Firebase 401")
            }
            if let mapped = authFailure(body) { throw OperatorMessage(text: mapped) }
            throw OperatorMessage(text: "다시 시도해 주세요.")
        }
        if data == Data("null".utf8) { return Data() }
        return data
    }

    private static func authFailure(_ body: String) -> String? {
        let text = body
        if text.range(of: "INVALID_PASSWORD|EMAIL_NOT_FOUND|INVALID_LOGIN|invalid-credential|wrong-password|user-not-found", options: [.regularExpression, .caseInsensitive]) != nil {
            return "이메일 또는 비밀번호가 올바르지 않습니다."
        }
        if text.range(of: "WEAK_PASSWORD|PASSWORD_DOES_NOT_MEET", options: .regularExpression) != nil {
            return "비밀번호는 6자 이상이어야 합니다."
        }
        if text.range(of: "network", options: .caseInsensitive) != nil, text.range(of: "fail", options: .caseInsensitive) != nil {
            return "네트워크에 연결하지 못했습니다."
        }
        return nil
    }
}

/// 다시 로그인할 표식만 보관합니다. 비밀번호는 보관하지 않습니다.
enum OperatorKeychain {
    private static let service = "com.anyplan.liveinterpret.phone.operator"
    private static let account = "session"

    static func save(refreshToken: String, email: String, localId: String) {
        let payload: [String: String] = [
            "refreshToken": refreshToken,
            "email": email,
            "localId": localId,
        ]
        guard let data = try? JSONSerialization.data(withJSONObject: payload) else { return }
        clear()
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecValueData as String: data,
        ]
        SecItemAdd(query as CFDictionary, nil)
    }

    static func load() -> (refreshToken: String, email: String, localId: String)? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
              let data = item as? Data,
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: String],
              let refreshToken = object["refreshToken"], !refreshToken.isEmpty,
              let email = object["email"], !email.isEmpty,
              let localId = object["localId"], !localId.isEmpty else { return nil }
        return (refreshToken, email, localId)
    }

    static func clear() {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        SecItemDelete(query as CFDictionary)
    }
}
