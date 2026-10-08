use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, Runtime};

#[derive(Debug, Deserialize)]
#[serde(tag = "event", content = "payload")]
pub enum NativeEvent {
    #[serde(rename = "lifecycle")]
    Lifecycle(NativeLifecycleEvent),
    #[serde(rename = "network")]
    Network { connected: bool },
    // Configuration/memory notifications do not describe an app phase.
    #[serde(rename = "configuration", alias = "memory-pressure")]
    Other {},
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum LifecyclePhase {
    Active,
    Inactive,
    Background,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeLifecycleEvent {
    pub phase: LifecyclePhase,
    /// Monotonic within the native process event source; independent of Rust epochs.
    pub native_sequence: u64,
    pub snapshot: bool,
}

/// One native subscription per process. The Channel callback runs on the native
/// calling thread: consumers must only enqueue work, never invoke Android here.
#[cfg(target_os = "android")]
pub async fn subscribe<R: Runtime>(
    app: &AppHandle<R>,
    on_event: impl Fn(NativeEvent) + Send + Sync + 'static,
) -> Result<(), String> {
    let handle = app
        .state::<crate::VcpMobileState<R>>()
        .mobile_plugin_handle()?;
    let channel = tauri::ipc::Channel::<serde_json::Value>::new(move |body| {
        match body.deserialize::<NativeEvent>() {
            Ok(event) => on_event(event),
            Err(error) => log::warn!("[VcpMobilePlugin] Invalid native event: {error}"),
        }
        Ok(())
    });
    // Do not cancel this future on a timeout: the mobile bridge must receive the
    // eventual native response. Kotlin resolves after installing and replaying.
    handle
        .run_mobile_plugin_async::<serde_json::Value>(
            "registerNativeEvents",
            serde_json::json!({ "channel": channel }),
        )
        .await
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ServiceFailure {
    Guardian,
    Helper,
    Events,
}

/// Bounded to the three capability failures. A snapshot drains failures that
/// occurred before the UI listener existed or while its WebView was suspended.
#[derive(Default)]
pub(crate) struct PendingServiceFailures(Mutex<BTreeSet<ServiceFailure>>);

pub fn report_service_failure<R: Runtime>(app: &AppHandle<R>, service: &str, error: &str) {
    log::warn!("[VcpMobilePlugin] {service} failed: {error}");
    let failure = match service {
        "guardian" => ServiceFailure::Guardian,
        "helper" => ServiceFailure::Helper,
        "events" => ServiceFailure::Events,
        _ => return,
    };
    if let Some(pending) = app.try_state::<PendingServiceFailures>() {
        if let Ok(mut failures) = pending.0.lock() {
            failures.insert(failure);
        }
    }
    let _ = app.emit(
        "vcp-system-event",
        serde_json::json!({ "type": "vcp-background-service-error", "service": failure }),
    );
}

pub fn take_service_failures<R: Runtime>(app: &AppHandle<R>) -> Vec<ServiceFailure> {
    let Some(pending) = app.try_state::<PendingServiceFailures>() else {
        return Vec::new();
    };
    let Ok(mut failures) = pending.0.lock() else {
        return Vec::new();
    };
    std::mem::take(&mut *failures).into_iter().collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_native_channel_snapshots_and_ignores_non_transition_events() {
        let pause: NativeEvent = serde_json::from_value(serde_json::json!({
            "event": "lifecycle",
            "payload": { "phase": "background", "nativeSequence": 3, "snapshot": true }
        }))
        .unwrap();
        assert!(matches!(
            pause,
            NativeEvent::Lifecycle(NativeLifecycleEvent {
                phase: LifecyclePhase::Background,
                native_sequence: 3,
                snapshot: true,
            })
        ));
        let network: NativeEvent = serde_json::from_value(serde_json::json!({
            "event": "network", "payload": { "connected": true }
        }))
        .unwrap();
        assert!(matches!(network, NativeEvent::Network { connected: true }));
        let configuration: NativeEvent = serde_json::from_value(serde_json::json!({
            "event": "configuration", "payload": { "isDarkMode": true }
        }))
        .unwrap();
        assert!(matches!(
            configuration,
            NativeEvent::Other {}
        ));
        assert!(serde_json::from_value::<NativeEvent>(serde_json::json!({
            "event": "network", "payload": { "connected": "true" }
        }))
        .is_err());
        for payload in [
            serde_json::json!({ "phase": "active", "snapshot": false }),
            serde_json::json!({ "phase": "resume", "nativeSequence": 4, "snapshot": false }),
            serde_json::json!({ "phase": "background", "nativeSequence": -1, "snapshot": false }),
        ] {
            assert!(serde_json::from_value::<NativeEvent>(serde_json::json!({
                "event": "lifecycle", "payload": payload,
            }))
            .is_err());
        }
    }
}
