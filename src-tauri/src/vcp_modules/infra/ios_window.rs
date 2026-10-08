//! iOS 单主窗口的进程存续与 Scene 重连装配。
//!
//! 只在 UIKit 事件回调中同步访问 Scene 和 Tauri 注册表，不复制窗口存活状态，
//! 也不重新初始化 Rust 业务状态。运行中的聊天输出恢复由 Chat 生命周期负责。

use objc2::MainThreadMarker;
use objc2_ui_kit::{UIApplication, UIScene, UIWindowScene, UIWindowSceneSessionRoleApplication};
use tauri::{AppHandle, Manager, RunEvent, Webview, WebviewWindow, WebviewWindowBuilder};

const MAIN_WINDOW_LABEL: &str = "main";

pub(crate) fn handle_run_event(app: &AppHandle, event: &RunEvent) -> Result<(), String> {
    match event {
        RunEvent::ExitRequested {
            code: None, api, ..
        } => {
            // runtime-wry 在本回调返回后立刻读取回复，必须同步阻止最后窗口引起的退出。
            // 显式 Some(code) 退出与 UIKit 终止进程不属于这个策略。
            api.prevent_exit();
            Ok(())
        }
        RunEvent::SceneRequested { scene, .. } => restore_main_window(app, scene),
        _ => Ok(()),
    }
}

fn restore_main_window(app: &AppHandle, scene: &UIScene) -> Result<(), String> {
    let mtm = MainThreadMarker::new()
        .ok_or_else(|| "validate scene: callback is not on the UIKit main thread".to_string())?;
    if scene.downcast_ref::<UIWindowScene>().is_none() {
        return Err("validate scene: requested scene is not a UIWindowScene".to_string());
    }

    let session = scene.session();
    // SAFETY: UIKit exports this immutable role constant; this module only builds for iOS.
    let application_role = unsafe { UIWindowSceneSessionRoleApplication };
    if !session.role().isEqualToString(application_role) {
        return Err("validate scene: requested session is not an application scene".to_string());
    }

    let connected_scenes = UIApplication::sharedApplication(mtm).connectedScenes();
    if connected_scenes.count() != 1 {
        return Err(format!(
            "validate scene: expected exactly one connected scene, found {}",
            connected_scenes.count()
        ));
    }
    let connected_scene = connected_scenes
        .anyObject()
        .ok_or_else(|| "validate scene: the connected scene is missing".to_string())?;
    if !std::ptr::eq(&*connected_scene, scene) {
        return Err("validate scene: requested scene is not the connected scene".to_string());
    }

    let expected_identifier = session.persistentIdentifier().to_string();
    if expected_identifier.is_empty() {
        return Err("validate scene: requested session has an empty identifier".to_string());
    }

    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        return verify_scene_binding(&window, &expected_identifier)
            .map_err(|error| format!("validate existing main: {error}"));
    }

    let config = app
        .config()
        .app
        .windows
        .iter()
        .find(|config| config.label == MAIN_WINDOW_LABEL)
        .ok_or_else(|| "restore main: main window configuration is missing".to_string())?;

    // Tauri 2.12.1 的纯 Window 查询受 unstable 限制。公开 builder 会在创建原生窗口前
    // 核对真实 WebView/Window 注册表，残缺的同名注册因此返回错误，不会产生副本。
    // tao 自动选取 Scene；唯一候选的数量/身份已在上方验证，下面还须核对实际绑定。
    // requested_by_scene_identifier 只表示请求来源，不能当作目标 Scene 绑定 API。
    let window = WebviewWindowBuilder::from_config(app, config)
        .map_err(|error| format!("restore main configuration: {error}"))?
        .build()
        .map_err(|error| match error {
            tauri::Error::WindowLabelAlreadyExists(label) => format!(
                "restore main: window registration {label:?} exists without the expected WebView"
            ),
            tauri::Error::WebviewLabelAlreadyExists(label) => {
                format!("restore main: WebView registration {label:?} is not a valid main window")
            }
            error => format!("restore main build: {error}"),
        })?;

    // 绑定异常时只报告，不销毁已创建窗口或循环创建；没有窗口时由后续真实请求重试。
    verify_scene_binding(&window, &expected_identifier)
        .map_err(|error| format!("verify restored main: {error}"))
}

fn verify_scene_binding(window: &WebviewWindow, expected_identifier: &str) -> Result<(), String> {
    // 使用 WebView 实际持有的 Window 的固有 API，避免依赖 sealed ManagerBase 方法。
    let webview: &Webview = window.as_ref();
    let native_window = webview.window();
    if native_window.label() != MAIN_WINDOW_LABEL {
        return Err(format!(
            "main WebView belongs to window {:?}",
            native_window.label()
        ));
    }
    let actual_identifier = native_window
        .scene_identifier()
        .map_err(|error| format!("read window scene identifier: {error}"))?;
    if actual_identifier.is_empty() {
        return Err("window scene identifier is empty".to_string());
    }
    if actual_identifier != expected_identifier {
        return Err(format!(
            "window is bound to session {actual_identifier:?}, requested {expected_identifier:?}"
        ));
    }
    Ok(())
}
