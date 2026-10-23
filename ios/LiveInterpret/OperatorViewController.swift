import UIKit

/// 맥의 계정 사용 화면과 같은 일을 합니다.
/// 계정 이름, 남은 잔액, 남은 시간, 최근 사용을 보여주고, 선불 잔액을 더합니다.
final class OperatorViewController: UIViewController {
    private let session: PhoneOperator
    private let listStack = UIStackView()
    private let accountButton = UIButton(type: .system)
    private let amountField = UITextField()
    private let messageLabel = UILabel()
    private let periodSwitch = UISwitch()
    private let periodMessage = UILabel()
    private var accounts: [OperatorAccount] = []
    private var selectedId = ""
    private var busy = false

    init(session: PhoneOperator) {
        self.session = session
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) { nil }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = ShellColor.background
        navigationItem.title = "계정 사용"
        guard PhoneOperator.isOperatorEmail(session.email) else {
            session.signOut()
            navigationController?.popViewController(animated: false)
            return
        }

        let scroll = UIScrollView()
        scroll.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(scroll)
        let body = UIStackView()
        body.axis = .vertical
        body.spacing = 16
        body.translatesAutoresizingMaskIntoConstraints = false
        scroll.addSubview(body)

        let intro = card(title: "계정 사용", lines: [
            "이 계정만 모든 계정의 남은 잔액, 남은 시간, 최근 사용을 봅니다.",
        ])
        listStack.axis = .vertical
        listStack.spacing = 12
        intro.addArrangedSubview(listStack)
        let signOut = UIButton(type: .system)
        signOut.setTitle("로그아웃", for: .normal)
        signOut.setTitleColor(ShellColor.text, for: .normal)
        signOut.addAction(UIAction { [weak self] _ in self?.signOut() }, for: .touchUpInside)
        intro.addArrangedSubview(signOut)

        let credit = card(title: "선불 잔액", lines: [])
        let accountLabel = fieldLabel("계정")
        var accountConfig = UIButton.Configuration.filled()
        accountConfig.title = "계정을 고르세요"
        accountConfig.baseBackgroundColor = ShellColor.background
        accountConfig.baseForegroundColor = ShellColor.text
        accountConfig.contentInsets = NSDirectionalEdgeInsets(top: 12, leading: 12, bottom: 12, trailing: 12)
        accountButton.configuration = accountConfig
        accountButton.contentHorizontalAlignment = .leading
        accountButton.addAction(UIAction { [weak self] _ in self?.pickAccount() }, for: .touchUpInside)
        let amountLabel = fieldLabel("더할 금액 (원)")
        amountField.keyboardType = .numberPad
        amountField.backgroundColor = ShellColor.background
        amountField.textColor = ShellColor.text
        amountField.font = .systemFont(ofSize: 17)
        amountField.layer.cornerRadius = 12
        amountField.leftView = UIView(frame: CGRect(x: 0, y: 0, width: 12, height: 44))
        amountField.leftViewMode = .always
        var creditConfig = UIButton.Configuration.filled()
        creditConfig.title = "선불 잔액 더하기"
        creditConfig.baseBackgroundColor = ShellColor.purple
        creditConfig.baseForegroundColor = ShellColor.text
        creditConfig.cornerStyle = .large
        let creditButton = UIButton(type: .system)
        creditButton.configuration = creditConfig
        creditButton.addAction(UIAction { [weak self] _ in self?.addCredit() }, for: .touchUpInside)
        messageLabel.textColor = ShellColor.hint
        messageLabel.font = .systemFont(ofSize: 16)
        messageLabel.numberOfLines = 0
        messageLabel.text = ""
        [accountLabel, accountButton, amountLabel, amountField, creditButton, messageLabel].forEach {
            credit.addArrangedSubview($0)
        }
        amountField.heightAnchor.constraint(equalToConstant: 48).isActive = true

        let period = card(title: "테스트 기간", lines: [
            "켜면 방송, 강연, 대면 모두 충전금을 빼지 않습니다. 끄면 기본 시간 10,000원, 추가 언어 2,000원, 추가 입력 3,000원으로 30분마다 빠집니다.",
        ])
        let row = UIStackView()
        row.axis = .horizontal
        row.alignment = .center
        let periodLabel = UILabel()
        periodLabel.text = "테스트 기간"
        periodLabel.textColor = ShellColor.text
        periodLabel.font = .systemFont(ofSize: 17, weight: .semibold)
        periodSwitch.onTintColor = ShellColor.purple
        periodSwitch.addAction(UIAction { [weak self] _ in self?.togglePeriod() }, for: .valueChanged)
        row.addArrangedSubview(periodLabel)
        row.addArrangedSubview(periodSwitch)
        periodMessage.textColor = ShellColor.hint
        periodMessage.font = .systemFont(ofSize: 16)
        periodMessage.numberOfLines = 0
        period.addArrangedSubview(row)
        period.addArrangedSubview(periodMessage)

        body.addArrangedSubview(period)
        body.addArrangedSubview(intro)
        body.addArrangedSubview(credit)
        let guide = view.safeAreaLayoutGuide
        NSLayoutConstraint.activate([
            scroll.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            scroll.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            scroll.topAnchor.constraint(equalTo: guide.topAnchor),
            scroll.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            body.leadingAnchor.constraint(equalTo: scroll.contentLayoutGuide.leadingAnchor, constant: 16),
            body.trailingAnchor.constraint(equalTo: scroll.contentLayoutGuide.trailingAnchor, constant: -16),
            body.topAnchor.constraint(equalTo: scroll.contentLayoutGuide.topAnchor, constant: 16),
            body.bottomAnchor.constraint(equalTo: scroll.contentLayoutGuide.bottomAnchor, constant: -16),
            body.widthAnchor.constraint(equalTo: scroll.frameLayoutGuide.widthAnchor, constant: -32),
        ])
        reload()
        loadPeriod()
    }

    private func loadPeriod() {
        Task {
            do {
                let on = try await operatorSession.testPeriodOn()
                periodSwitch.setOn(on, animated: false)
                periodMessage.text = on ? "테스트 기간이 켜져 있습니다." : "테스트 기간이 꺼져 있습니다."
            } catch {
                periodMessage.text = PhoneOperator.userFacing(error)
            }
        }
    }

    private func togglePeriod() {
        let on = periodSwitch.isOn
        periodSwitch.isEnabled = false
        Task {
            do {
                let next = try await operatorSession.setTestPeriod(on)
                periodSwitch.setOn(next, animated: true)
                periodMessage.text = next ? "테스트 기간이 켜져 있습니다." : "테스트 기간이 꺼져 있습니다."
            } catch {
                periodSwitch.setOn(!on, animated: true)
                periodMessage.text = PhoneOperator.userFacing(error)
            }
            periodSwitch.isEnabled = true
        }
    }

    override var preferredStatusBarStyle: UIStatusBarStyle { .lightContent }

    private func card(title: String, lines: [String]) -> UIStackView {
        let stack = UIStackView()
        stack.axis = .vertical
        stack.spacing = 8
        stack.layoutMargins = UIEdgeInsets(top: 16, left: 16, bottom: 16, right: 16)
        stack.isLayoutMarginsRelativeArrangement = true
        stack.backgroundColor = ShellColor.card
        stack.layer.cornerRadius = 16
        let heading = UILabel()
        heading.text = title
        heading.textColor = ShellColor.text
        heading.font = .systemFont(ofSize: 22, weight: .bold)
        stack.addArrangedSubview(heading)
        for line in lines {
            let label = UILabel()
            label.text = line
            label.textColor = ShellColor.hint
            label.font = .systemFont(ofSize: 15)
            label.numberOfLines = 0
            stack.addArrangedSubview(label)
        }
        return stack
    }

    private func fieldLabel(_ text: String) -> UILabel {
        let label = UILabel()
        label.text = text
        label.textColor = ShellColor.hint
        label.font = .systemFont(ofSize: 14)
        return label
    }

    private func reload() {
        Task { [weak self] in
            do {
                let rows = try await self?.session.listAccounts() ?? []
                await MainActor.run {
                    self?.show(rows)
                }
            } catch {
                await MainActor.run {
                    guard let self else { return }
                    if Self.denied(error) {
                        self.leaveDenied()
                        return
                    }
                    self.messageLabel.text = PhoneOperator.userFacing(error)
                }
            }
        }
    }

    private func show(_ rows: [OperatorAccount]) {
        accounts = rows
        listStack.arrangedSubviews.forEach {
            listStack.removeArrangedSubview($0)
            $0.removeFromSuperview()
        }
        if rows.isEmpty {
            let empty = UILabel()
            empty.text = "등록된 계정이 없습니다."
            empty.textColor = ShellColor.hint
            empty.numberOfLines = 0
            listStack.addArrangedSubview(empty)
            selectedId = ""
            accountButton.setTitle("계정을 고르세요", for: .normal)
            return
        }
        if !rows.contains(where: { $0.id == selectedId }) {
            selectedId = rows[0].id
        }
        for row in rows {
            let card = UIStackView()
            card.axis = .vertical
            card.spacing = 4
            let title = UILabel()
            title.text = row.name
            title.textColor = ShellColor.text
            title.font = .systemFont(ofSize: 18, weight: .semibold)
            let balance = UILabel()
            balance.text = "남은 잔액 \(row.balanceLabel)"
            balance.textColor = ShellColor.text
            balance.font = .systemFont(ofSize: 16)
            let time = UILabel()
            time.text = row.timeLabel
            time.textColor = ShellColor.text
            time.font = .systemFont(ofSize: 16)
            let recent = UILabel()
            recent.text = row.recentLabel == "최근 사용 없음" ? row.recentLabel : "최근 사용 \(row.recentLabel)"
            recent.textColor = ShellColor.hint
            recent.font = .systemFont(ofSize: 14)
            recent.numberOfLines = 0
            [title, balance, time, recent].forEach { card.addArrangedSubview($0) }
            listStack.addArrangedSubview(card)
        }
        let picked = rows.first { $0.id == selectedId }
        accountButton.setTitle(picked?.name ?? "계정을 고르세요", for: .normal)
    }

    private func pickAccount() {
        guard !accounts.isEmpty else { return }
        let sheet = UIAlertController(title: "계정", message: nil, preferredStyle: .actionSheet)
        for row in accounts {
            sheet.addAction(UIAlertAction(title: row.name, style: .default) { [weak self] _ in
                self?.selectedId = row.id
                self?.accountButton.setTitle(row.name, for: .normal)
            })
        }
        sheet.addAction(UIAlertAction(title: "닫기", style: .cancel))
        sheet.popoverPresentationController?.sourceView = accountButton
        present(sheet, animated: true)
    }

    private func addCredit() {
        guard !busy else { return }
        let amount = PhoneOperator.parsedAmount(amountField.text ?? "")
        if amount <= 0 {
            messageLabel.text = "충전할 금액을 적으세요"
            return
        }
        guard !selectedId.isEmpty else {
            messageLabel.text = "계정을 골라 주세요."
            return
        }
        messageLabel.text = ""
        busy = true
        let accountId = selectedId
        Task { [weak self] in
            do {
                let label = try await self?.session.addCredit(accountId: accountId, amount: amount) ?? ""
                await MainActor.run {
                    guard let self else { return }
                    self.busy = false
                    self.amountField.text = ""
                    let grouped = NumberFormatter.localizedString(from: NSNumber(value: amount), number: .decimal)
                    self.messageLabel.text = "\(grouped)원을 더했습니다. 남은 잔액은 \(label)입니다."
                    self.reload()
                }
            } catch {
                await MainActor.run {
                    guard let self else { return }
                    self.busy = false
                    if Self.denied(error) {
                        self.leaveDenied()
                        return
                    }
                    let text = PhoneOperator.userFacing(error)
                    self.messageLabel.text = text == "충전할 금액을 적으세요" ? text : text
                }
            }
        }
    }

    private func signOut() {
        session.signOut()
        navigationController?.popToRootViewController(animated: true)
    }

    private func leaveDenied() {
        session.signOut()
        navigationController?.popToRootViewController(animated: true)
    }

    private static func denied(_ error: Error) -> Bool {
        guard let message = error as? OperatorMessage else { return false }
        return message.text == "이 계정은 운영 화면을 열 수 없습니다."
    }
}
