fn main() {
    tauri_build::build();

    // Windows 仅用于本地开发/测试。Tauri 的默认 manifest 资源只链接到 bins，
    // 不覆盖 lib 单元测试；测试程序同样需要其默认启用的 Common Controls v6。
    // 按编译目标判断，避免在 Windows 上构建 Android 时传入 MSVC 链接参数。
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows")
        && std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc")
    {
        println!("cargo:rustc-link-arg=/MANIFEST:EMBED");
        println!(
            "cargo:rustc-link-arg=/MANIFESTDEPENDENCY:type='win32' name='Microsoft.Windows.Common-Controls' version='6.0.0.0' processorArchitecture='*' publicKeyToken='6595b64144ccf1df' language='*'"
        );
    }
}
