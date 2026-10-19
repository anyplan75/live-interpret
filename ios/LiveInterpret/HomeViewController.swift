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

        let titleLabel = UILabel()
        titleLabel.text = "실시간 통역"
        titleLabel.font = .systemFont(ofSize: 28, weight: .bold)
        titleLabel.textColor = ShellColor.text

        let hint = UILabel()
        hint.text = "쓸 화면을 고르세요. 통역은 이미 공개된 페이지가 합니다."
        hint.font = .systemFont(ofSize: 15)
        hint.textColor = ShellColor.hint
        hint.numberOfLines = 0

        let lecture = makeButton(for: .lecture)
        let face = makeButton(for: .face)
        let stack = UIStackView(arrangedSubviews: [titleLabel, hint, lecture, face])
        stack.axis = .vertical
        stack.spacing = 16
        stack.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(stack)

        let guide = view.safeAreaLayoutGuide
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: guide.leadingAnchor, constant: 20),
            stack.trailingAnchor.constraint(equalTo: guide.trailingAnchor, constant: -20),
            stack.topAnchor.constraint(equalTo: guide.topAnchor, constant: 28),
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
        button.backgroundColor = ShellColor.card
        button.layer.cornerRadius = 16
        button.contentHorizontalAlignment = .leading
        button.configuration = nil
        var config = UIButton.Configuration.plain()
        config.title = page.title
        config.subtitle = page.detail
        config.baseForegroundColor = ShellColor.text
        config.titleAlignment = .leading
        config.contentInsets = NSDirectionalEdgeInsets(top: 18, leading: 18, bottom: 18, trailing: 18)
        config.titleTextAttributesTransformer = UIConfigurationTextAttributesTransformer { incoming in
            var outgoing = incoming
            outgoing.font = .systemFont(ofSize: 22, weight: .semibold)
            return outgoing
        }
        config.subtitleTextAttributesTransformer = UIConfigurationTextAttributesTransformer { incoming in
            var outgoing = incoming
            outgoing.font = .systemFont(ofSize: 14)
            outgoing.foregroundColor = ShellColor.hint
            return outgoing
        }
        button.configuration = config
        button.heightAnchor.constraint(greaterThanOrEqualToConstant: 88).isActive = true
        button.addAction(UIAction { [weak self] _ in
            self?.navigationController?.pushViewController(PageViewController(page: page), animated: true)
        }, for: .touchUpInside)
        return button
    }
}
