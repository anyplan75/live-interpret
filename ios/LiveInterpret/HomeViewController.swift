import UIKit

enum ShellColor {
    static let background = UIColor(red: 15 / 255, green: 20 / 255, blue: 25 / 255, alpha: 1)
    static let text = UIColor.white
    /// 앱 아이콘 말풍선의 보라 `#8860C0`. 버튼은 이 색의 밝기만 바꾼다.
    static let iconPurple = UIColor(red: 136 / 255, green: 96 / 255, blue: 192 / 255, alpha: 1)
    static let iconPurplePressed = UIColor(red: 117 / 255, green: 83 / 255, blue: 165 / 255, alpha: 1)
    /// 아이콘 밝은 면과 같은 계열의 연보라.
    static let lilac = UIColor(red: 238 / 255, green: 232 / 255, blue: 246 / 255, alpha: 1)
    static let lilacPressed = UIColor(red: 224 / 255, green: 212 / 255, blue: 240 / 255, alpha: 1)
    static let lilacEdge = UIColor(red: 205 / 255, green: 186 / 255, blue: 228 / 255, alpha: 1)
    static let deepPurple = UIColor(red: 78 / 255, green: 44 / 255, blue: 128 / 255, alpha: 1)
    static let deepPurpleSoft = UIColor(red: 98 / 255, green: 64 / 255, blue: 146 / 255, alpha: 1)
}

/// 첫 화면. 강연·회의와 대면통역 중 하나를 고른다.
final class HomeViewController: UIViewController {
    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = ShellColor.background
        navigationItem.title = "실시간 통역"
        applyNavigationStyle()

        let lecture = makeButton(for: .lecture)
        let face = makeButton(for: .face)
        let buttons = UIStackView(arrangedSubviews: [lecture, face])
        buttons.axis = .vertical
        buttons.spacing = 16
        buttons.distribution = .fillEqually
        buttons.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(buttons)

        let guide = view.safeAreaLayoutGuide
        NSLayoutConstraint.activate([
            buttons.leadingAnchor.constraint(equalTo: guide.leadingAnchor, constant: 20),
            buttons.trailingAnchor.constraint(equalTo: guide.trailingAnchor, constant: -20),
            buttons.topAnchor.constraint(equalTo: guide.topAnchor, constant: 8),
            buttons.bottomAnchor.constraint(equalTo: guide.bottomAnchor, constant: -12),
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

    private func makeButton(for page: PhonePage) -> HomeChoiceButton {
        let style: HomeChoiceStyle = page == .lecture
            ? HomeChoiceStyle(
                fill: ShellColor.iconPurple,
                pressedFill: ShellColor.iconPurplePressed,
                titleColor: ShellColor.text,
                detailColor: ShellColor.text,
                borderColor: nil
            )
            : HomeChoiceStyle(
                fill: ShellColor.lilac,
                pressedFill: ShellColor.lilacPressed,
                titleColor: ShellColor.deepPurple,
                detailColor: ShellColor.deepPurpleSoft,
                borderColor: ShellColor.lilacEdge
            )
        let button = HomeChoiceButton(title: page.title, detail: page.detail, style: style)
        button.addAction(UIAction { [weak self] _ in
            self?.navigationController?.pushViewController(PageViewController(page: page), animated: true)
        }, for: .touchUpInside)
        return button
    }
}

private struct HomeChoiceStyle {
    let fill: UIColor
    let pressedFill: UIColor
    let titleColor: UIColor
    let detailColor: UIColor
    let borderColor: UIColor?
}

/// 첫 화면의 큰 선택 버튼. 제목과 두 줄 설명이 버튼 한가운데에 있다.
private final class HomeChoiceButton: UIControl {
    private let fill: UIColor
    private let pressedFill: UIColor

    init(title: String, detail: String, style: HomeChoiceStyle) {
        fill = style.fill
        pressedFill = style.pressedFill
        super.init(frame: .zero)
        backgroundColor = style.fill
        layer.cornerRadius = 28
        layer.cornerCurve = .continuous
        if let borderColor = style.borderColor {
            layer.borderWidth = 1
            layer.borderColor = borderColor.cgColor
        }
        isAccessibilityElement = true
        accessibilityTraits = .button
        accessibilityLabel = "\(title). \(detail.replacingOccurrences(of: "\n", with: " "))"

        let titleLabel = UILabel()
        titleLabel.attributedText = Self.titleText(title, color: style.titleColor)
        titleLabel.textAlignment = .center
        titleLabel.numberOfLines = 1
        titleLabel.adjustsFontSizeToFitWidth = true
        titleLabel.minimumScaleFactor = 0.8

        let detailLabel = UILabel()
        detailLabel.attributedText = Self.detailText(detail, color: style.detailColor)
        detailLabel.textAlignment = .center
        detailLabel.numberOfLines = 2

        let stack = UIStackView(arrangedSubviews: [titleLabel, detailLabel])
        stack.axis = .vertical
        stack.alignment = .fill
        stack.spacing = 14
        stack.isUserInteractionEnabled = false
        stack.translatesAutoresizingMaskIntoConstraints = false
        addSubview(stack)
        NSLayoutConstraint.activate([
            stack.centerYAnchor.constraint(equalTo: centerYAnchor),
            stack.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 22),
            stack.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -22),
        ])
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("스토리보드로 만들지 않습니다.")
    }

    override var isHighlighted: Bool {
        didSet { backgroundColor = isHighlighted ? pressedFill : fill }
    }

    private static func titleText(_ text: String, color: UIColor) -> NSAttributedString {
        NSAttributedString(string: text, attributes: [
            .font: UIFont.systemFont(ofSize: 34, weight: .bold),
            .foregroundColor: color,
            .kern: -0.4,
        ])
    }

    /// 설명은 글자를 조금 띄우고, 두 줄 사이도 버튼 높이에 맞게 벌린다.
    private static func detailText(_ text: String, color: UIColor) -> NSAttributedString {
        let paragraph = NSMutableParagraphStyle()
        paragraph.alignment = .center
        paragraph.lineSpacing = 8
        paragraph.lineBreakMode = .byWordWrapping
        return NSAttributedString(string: text, attributes: [
            .font: UIFont.systemFont(ofSize: 17, weight: .medium),
            .foregroundColor: color,
            .kern: 0.8,
            .paragraphStyle: paragraph,
        ])
    }
}
