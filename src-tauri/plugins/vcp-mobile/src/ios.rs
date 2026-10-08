//! The iOS bridge exposes only the two selectors consumed by Phase 2.
//! DTOs remain readable on host for contract checks, without a host native adapter.
use serde::Deserialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum NativeRuntime {
    Available,
    Unknown,
    Unavailable,
}

#[derive(Debug, Deserialize)]
pub struct NativeCapabilityObservation {
    pub implemented: bool,
    pub runtime: NativeRuntime,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum NativePlatform {
    Ios,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeCapabilities {
    pub protocol_version: u32,
    pub platform: NativePlatform,
    pub lifecycle: NativeCapabilityObservation,
    /// Connectivity events are not the full device telemetry NetworkStatus API.
    pub network_events: NativeCapabilityObservation,
}

impl NativeCapabilities {
    pub fn validate(&self) -> Result<(), String> {
        validate_protocol(self.protocol_version)?;
        for observation in [&self.lifecycle, &self.network_events] {
            if !observation.implemented && observation.runtime == NativeRuntime::Available {
                return Err(
                    "native_protocol: unavailable adapter reported an available runtime".into(),
                );
            }
        }
        Ok(())
    }
}

fn validate_protocol(version: u32) -> Result<(), String> {
    if version != 1 {
        return Err(format!(
            "native_protocol: unsupported iOS bridge version {version}"
        ));
    }
    Ok(())
}

#[cfg(any(target_os = "ios", test))]
use std::{
    future::Future,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::Duration,
};

#[cfg(target_os = "ios")]
use tauri::{AppHandle, Manager, Runtime};

/// One retained receiver per selector. A stalled native queue cannot create an
/// unbounded population of detached bridge tasks through repeated UI retries.
#[cfg(target_os = "ios")]
#[derive(Default)]
pub(crate) struct NativeCalls {
    capabilities: Arc<AtomicBool>,
    events: Arc<AtomicBool>,
}

#[cfg(any(target_os = "ios", test))]
struct CallSlot(Arc<AtomicBool>);

#[cfg(any(target_os = "ios", test))]
impl Drop for CallSlot {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}

/// The caller may stop waiting, but Tauri's native response receiver must stay
/// alive: Tauri 2.12.1 still unwraps its callback send. Never abort this spawned task.
#[cfg(any(target_os = "ios", test))]
async fn receive_native<T, F>(
    busy: Arc<AtomicBool>,
    operation: &'static str,
    response: F,
) -> Result<T, String>
where
    T: Send + 'static,
    F: Future<Output = Result<T, String>> + Send + 'static,
{
    busy.compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .map_err(|_| format!("native_busy: {operation} still awaits its native response"))?;
    let slot = CallSlot(busy);
    let receiver = tauri::async_runtime::spawn(async move {
        let _slot = slot;
        response.await
    });
    // Cancelling this wait drops only the JoinHandle. Tokio detaches the task,
    // retaining the mobile receiver until Swift resolves/rejects and releases it.
    receiver
        .await
        .map_err(|error| format!("native_bridge: {operation}: {error}"))?
}

#[cfg(target_os = "ios")]
const CAPABILITIES_RESPONSE_DEADLINE: Duration = Duration::from_secs(5);

#[cfg(target_os = "ios")]
pub async fn get_native_capabilities<R: Runtime>(
    app: &AppHandle<R>,
) -> Result<NativeCapabilities, String> {
    let state = app.state::<crate::VcpMobileState<R>>();
    let handle = state.mobile_plugin_handle()?;
    let busy = state.ios_calls.capabilities.clone();
    let capabilities = tokio::time::timeout(
        CAPABILITIES_RESPONSE_DEADLINE,
        receive_native(busy, "getNativeCapabilities", async move {
            handle
                .run_mobile_plugin_async::<NativeCapabilities>(
                    "getNativeCapabilities",
                    serde_json::json!({}),
                )
                .await
                .map_err(|error| error.to_string())
        }),
    )
    .await
    .map_err(|_| {
        "native_timeout: getNativeCapabilities did not respond within the deadline".to_string()
    })??;
    capabilities.validate()?;
    Ok(capabilities)
}

#[cfg(target_os = "ios")]
pub(crate) async fn register_native_events<R: Runtime>(
    app: &AppHandle<R>,
    channel: tauri::ipc::Channel<serde_json::Value>,
) -> Result<(), String> {
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Registration {
        protocol_version: u32,
    }
    let state = app.state::<crate::VcpMobileState<R>>();
    let handle = state.mobile_plugin_handle()?;
    let busy = state.ios_calls.events.clone();
    // The bootstrap subscription task consumes the final acknowledgement, even
    // when the native queue takes longer than a capability query may wait.
    let registration = receive_native(busy, "registerNativeEvents", async move {
        handle
            .run_mobile_plugin_async::<Registration>(
                "registerNativeEvents",
                serde_json::json!({ "channel": channel }),
            )
            .await
            .map_err(|error| error.to_string())
    })
    .await?;
    validate_protocol(registration.protocol_version)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::sync::oneshot;

    async fn wait_until_idle(busy: &AtomicBool) {
        tokio::time::timeout(Duration::from_secs(1), async {
            while busy.load(Ordering::Acquire) {
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("the late native response must release its call slot");
    }

    #[test]
    fn validates_native_observations_without_inventing_readiness() {
        let payload = serde_json::json!({
            "protocolVersion": 1,
            "platform": "ios",
            "lifecycle": { "implemented": true, "runtime": "unknown" },
            "networkEvents": { "implemented": true, "runtime": "available" }
        });
        let capabilities: NativeCapabilities = serde_json::from_value(payload.clone()).unwrap();
        capabilities.validate().unwrap();
        assert_eq!(capabilities.lifecycle.runtime, NativeRuntime::Unknown);
        let mut wrong_version = payload.clone();
        wrong_version["protocolVersion"] = 2.into();
        assert!(serde_json::from_value::<NativeCapabilities>(wrong_version)
            .unwrap()
            .validate()
            .is_err());
        let mut wrong_platform = payload;
        wrong_platform["platform"] = "android".into();
        assert!(serde_json::from_value::<NativeCapabilities>(wrong_platform).is_err());
    }

    #[tokio::test]
    async fn caller_timeout_keeps_native_receiver_and_slot_until_late_completion() {
        let busy = Arc::new(AtomicBool::new(false));
        let (sender, response) = oneshot::channel::<u32>();
        let (finished, completion) = oneshot::channel();
        let result = tokio::time::timeout(
            Duration::ZERO,
            receive_native(busy.clone(), "test", async move {
                let value = response.await.map_err(|error| error.to_string())?;
                let _ = finished.send(());
                Ok(value)
            }),
        )
        .await;
        assert!(result.is_err());
        assert!(busy.load(Ordering::Acquire));
        let rejected = receive_native(busy.clone(), "test", async { Ok(0_u32) }).await;
        assert!(rejected.unwrap_err().starts_with("native_busy:"));
        // Models Tauri's send(response).unwrap(): a dropped receiver would fail.
        sender.send(7).unwrap();
        tokio::time::timeout(Duration::from_secs(1), completion)
            .await
            .unwrap()
            .unwrap();
        wait_until_idle(&busy).await;
        assert_eq!(
            receive_native(busy, "test", async { Ok(8_u32) })
                .await
                .unwrap(),
            8
        );
    }

    #[tokio::test]
    async fn cancelling_the_caller_does_not_cancel_native_work() {
        let busy = Arc::new(AtomicBool::new(false));
        let (started, start) = oneshot::channel();
        let (sender, response) = oneshot::channel::<u32>();
        let (finished, completion) = oneshot::channel();
        let caller_busy = busy.clone();
        let caller = tokio::spawn(async move {
            receive_native(caller_busy, "test", async move {
                let _ = started.send(());
                let value = response.await.map_err(|error| error.to_string())?;
                let _ = finished.send(());
                Ok(value)
            })
            .await
        });
        tokio::time::timeout(Duration::from_secs(1), start)
            .await
            .unwrap()
            .unwrap();
        caller.abort();
        assert!(caller.await.unwrap_err().is_cancelled());
        assert!(busy.load(Ordering::Acquire));
        sender.send(9).unwrap();
        tokio::time::timeout(Duration::from_secs(1), completion)
            .await
            .unwrap()
            .unwrap();
        wait_until_idle(&busy).await;
    }

    #[tokio::test]
    async fn retained_wait_delivers_the_final_native_success_or_failure() {
        for outcome in [Ok(7_u32), Err("native_events: rejected".to_string())] {
            let busy = Arc::new(AtomicBool::new(false));
            let (sender, response) = oneshot::channel();
            let caller = receive_native(busy.clone(), "test", async move {
                response.await.map_err(|error| error.to_string())?
            });
            tokio::pin!(caller);

            // Borrow the wait so this observation does not cancel its owner.
            assert!(tokio::time::timeout(Duration::from_millis(10), &mut caller)
                .await
                .is_err());
            assert!(busy.load(Ordering::Acquire));
            sender.send(outcome.clone()).unwrap();
            assert_eq!(
                tokio::time::timeout(Duration::from_secs(1), caller)
                    .await
                    .unwrap(),
                outcome
            );
            assert!(!busy.load(Ordering::Acquire));
        }
    }
}
