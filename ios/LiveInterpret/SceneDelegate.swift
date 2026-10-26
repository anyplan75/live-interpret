import UIKit

enum ShellColor {
    static let background = UIColor(red: 15 / 255, green: 20 / 255, blue: 25 / 255, alpha: 1)
    static let card = UIColor(red: 28 / 255, green: 34 / 255, blue: 42 / 255, alpha: 1)
    static let purple = UIColor(red: 91 / 255, green: 45 / 255, blue: 142 / 255, alpha: 1)
    static let text = UIColor.white
    static let hint = UIColor(white: 0.78, alpha: 1)
}

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(
        _ scene: UIScene,
        willConnectTo session: UISceneSession,
        options connectionOptions: UIScene.ConnectionOptions
    ) {
        guard let windowScene = scene as? UIWindowScene else { return }
        let window = UIWindow(windowScene: windowScene)
        window.backgroundColor = ShellColor.background
        window.rootViewController = UINavigationController(rootViewController: PageViewController(page: .face))
        window.makeKeyAndVisible()
        self.window = window
    }
}
