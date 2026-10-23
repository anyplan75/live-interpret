import UIKit

/// 이메일과 비밀번호를 입력하는 화면. 비밀번호는 코드에 없습니다.
final class SignInViewController: UIViewController {
    private let emailField = UITextField()
    private let secretField = UITextField()
    private let messageLabel = UILabel()
    private let submitButton = UIButton(type: .system)
    private var signingIn = false

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = ShellColor.background
        navigationItem.title = "로그인"

        let hint = UILabel()
        hint.text = "운영 계정으로 로그인하면 계정 사용 화면이 열립니다."
        hint.font = .systemFont(ofSize: 16)
        hint.textColor = ShellColor.hint
        hint.numberOfLines = 0

        style(emailField, placeholder: "이메일")
        emailField.keyboardType = .emailAddress
        emailField.textContentType = .username
        emailField.autocapitalizationType = .none
        emailField.autocorrectionType = .no

        style(secretField, placeholder: "비밀번호")
        secretField.isSecureTextEntry = true
        secretField.textContentType = .password
        secretField.autocapitalizationType = .none
        secretField.autocorrectionType = .no

        var config = UIButton.Configuration.filled()
        config.title = "로그인"
        config.baseBackgroundColor = ShellColor.purple
        config.baseForegroundColor = ShellColor.text
        config.cornerStyle = .large
        config.contentInsets = NSDirectionalEdgeInsets(top: 14, leading: 18, bottom: 14, trailing: 18)
        submitButton.configuration = config
        submitButton.addAction(UIAction { [weak self] _ in self?.submit() }, for: .touchUpInside)

        messageLabel.textColor = ShellColor.hint
        messageLabel.font = .systemFont(ofSize: 16)
        messageLabel.numberOfLines = 0
        messageLabel.text = ""

        let stack = UIStackView(arrangedSubviews: [hint, emailField, secretField, submitButton, messageLabel])
        stack.axis = .vertical
        stack.spacing = 14
        stack.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(stack)
        let guide = view.safeAreaLayoutGuide
        NSLayoutConstraint.activate([
            emailField.heightAnchor.constraint(equalToConstant: 48),
            secretField.heightAnchor.constraint(equalToConstant: 48),
            stack.leadingAnchor.constraint(equalTo: guide.leadingAnchor, constant: 20),
            stack.trailingAnchor.constraint(equalTo: guide.trailingAnchor, constant: -20),
            stack.topAnchor.constraint(equalTo: guide.topAnchor, constant: 24),
        ])
    }

    override var preferredStatusBarStyle: UIStatusBarStyle { .lightContent }

    private func style(_ field: UITextField, placeholder: String) {
        field.backgroundColor = ShellColor.card
        field.textColor = ShellColor.text
        field.font = .systemFont(ofSize: 17)
        field.layer.cornerRadius = 12
        field.leftView = UIView(frame: CGRect(x: 0, y: 0, width: 12, height: 48))
        field.leftViewMode = .always
        field.attributedPlaceholder = NSAttributedString(
            string: placeholder,
            attributes: [.foregroundColor: ShellColor.hint]
        )
    }

    private func submit() {
        guard !signingIn else { return }
        messageLabel.text = ""
        let email = emailField.text ?? ""
        let secret = secretField.text ?? ""
        secretField.text = ""
        signingIn = true
        submitButton.isEnabled = false
        Task { [weak self] in
            do {
                let session = try await PhoneOperator.signIn(email: email, secret: secret)
                await MainActor.run {
                    guard let self else { return }
                    self.openOperator(session)
                }
            } catch {
                await MainActor.run {
                    guard let self else { return }
                    self.signingIn = false
                    self.submitButton.isEnabled = true
                    self.messageLabel.text = PhoneOperator.userFacing(error)
                }
            }
        }
    }

    /// 운영 계정만 계정 사용 화면으로 넘어갑니다. 다른 계정은 이 화면에 남습니다.
    private func openOperator(_ session: PhoneOperator) {
        guard PhoneOperator.isOperatorEmail(session.email) else {
            session.signOut()
            signingIn = false
            submitButton.isEnabled = true
            messageLabel.text = "이 계정은 운영 화면을 열 수 없습니다."
            return
        }
        let board = OperatorViewController(session: session)
        navigationController?.pushViewController(board, animated: true)
        if var controllers = navigationController?.viewControllers {
            controllers.removeAll { $0 is SignInViewController }
            navigationController?.setViewControllers(controllers, animated: false)
        }
    }
}
