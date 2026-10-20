import UIKit

enum ShellColor {
    static let background = UIColor(red: 15 / 255, green: 20 / 255, blue: 25 / 255, alpha: 1)
    static let card = UIColor(red: 28 / 255, green: 34 / 255, blue: 42 / 255, alpha: 1)
    static let purple = UIColor(red: 91 / 255, green: 45 / 255, blue: 142 / 255, alpha: 1)
    static let text = UIColor.white
    static let hint = UIColor(white: 0.78, alpha: 1)
}

/// 첫 화면. 강연·회의와 대면통역 중 하나를 고른다.
final class HomeViewController: UIViewController {
    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = ShellColor.background
        navigationItem.title = "실시간 통역"
        applyNavigationStyle()

        let hint = UILabel()
        hint.text = "쓸 화면을 고르세요."
        hint.font = .systemFont(ofSize: 17, weight: .medium)
        hint.textColor = ShellColor.hint
        hint.textAlignment = .center
        hint.numberOfLines = 0
        hint.setContentHuggingPriority(.required, for: .vertical)

        let lecture = makeButton(for: .lecture)
        let face = makeButton(for: .face)
        let buttons = UIStackView(arrangedSubviews: [lecture, face])
        buttons.axis = .vertical
        buttons.spacing = 16
        buttons.distribution = .fillEqually
        buttons.setContentHuggingPriority(.defaultLow, for: .vertical)

        let stack = UIStackView(arrangedSubviews: [hint, buttons])
        stack.axis = .vertical
        stack.spacing = 20
        stack.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(stack)

        let guide = view.safeAreaLayoutGuide
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: guide.leadingAnchor, constant: 20),
            stack.trailingAnchor.constraint(equalTo: guide.trailingAnchor, constant: -20),
            stack.topAnchor.constraint(equalTo: guide.topAnchor, constant: 12),
            stack.bottomAnchor.constraint(equalTo: guide.bottomAnchor, constant: -16),
        ])
    }

    override var preferredStatusBarStyle: UIStatusBarStyle { .lightContent }

    private func applyNavigationStyle() {
        let appearance = UINavigationBarAppearance()
        appearance.configureWithOpaqueBackground()
        appearance.backgroundColor = ShellColor.background
        appearance.titleTextAttributes = [.foregroundColor: ShellColor.text]
        navigationController?.navigationBar.standardAppearance = appearance
        navigationController?.navigationBar.scrollEdgeAppearance = appearance
        navigationController?.navigationBar.tintColor = ShellColor.text
    }

    private func makeButton(for page: PhonePage) -> UIButton {
        let button = UIButton(type: .system)
        var config = UIButton.Configuration.filled()
        config.title = page.title
        config.subtitle = page.detail
        config.baseForegroundColor = ShellColor.text
        config.baseBackgroundColor = ShellColor.card
        config.background.cornerRadius = 28
        config.titleAlignment = .center
        config.contentInsets = NSDirectionalEdgeInsets(top: 24, leading: 20, bottom: 24, trailing: 20)
        config.titleTextAttributesTransformer = UIConfigurationTextAttributesTransformer { incoming in
            var outgoing = incoming
            outgoing.font = .systemFont(ofSize: 34, weight: .bold)
            return outgoing
        }
        config.subtitleTextAttributesTransformer = UIConfigurationTextAttributesTransformer { incoming in
            var outgoing = incoming
            outgoing.font = .systemFont(ofSize: 17)
            outgoing.foregroundColor = ShellColor.hint
            return outgoing
        }
        button.configuration = config
        button.addAction(UIAction { [weak self] _ in
            self?.navigationController?.pushViewController(PageViewController(page: page), animated: true)
        }, for: .touchUpInside)
        return button
    }
}
