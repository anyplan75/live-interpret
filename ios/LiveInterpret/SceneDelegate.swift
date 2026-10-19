import UIKit

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
        window.rootViewController = UINavigationController(rootViewController: HomeViewController())
        window.makeKeyAndVisible()
        self.window = window
    }
}
