//! Platform facts and implementation availability, independent of permission grants.
//! Native adapters will supply authorization/runtime observations when they exist.
use serde::Serialize;
use std::collections::BTreeMap;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)] // All target names belong to the wire contract, including on host builds.
pub enum Platform {
    Android,
    Ios,
    Host,
}

pub const fn current_platform() -> Platform {
    #[cfg(target_os = "android")]
    {
        Platform::Android
    }
    #[cfg(target_os = "ios")]
    {
        Platform::Ios
    }
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        Platform::Host
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum CapabilityName {
    AndroidPermissionGate,
    ApkUpdate,
    NativeInsets,
    IncomingShare,
    SystemNotifications,
    MoveTaskToBack,
    RootAccess,
    Cli,
    Distributed,
    VoiceRecording,
    Camera,
    FilePicker,
    PhotoPicker,
    GallerySave,
    FileExport,
    OutgoingShare,
    FileOpen,
    BatteryStatus,
    NetworkStatus,
    DiskSpace,
    KeepScreenOn,
    BackgroundExecution,
    Lifecycle,
    WebviewCache,
}

const CAPABILITIES: [CapabilityName; 24] = [
    CapabilityName::AndroidPermissionGate,
    CapabilityName::ApkUpdate,
    CapabilityName::NativeInsets,
    CapabilityName::IncomingShare,
    CapabilityName::SystemNotifications,
    CapabilityName::MoveTaskToBack,
    CapabilityName::RootAccess,
    CapabilityName::Cli,
    CapabilityName::Distributed,
    CapabilityName::VoiceRecording,
    CapabilityName::Camera,
    CapabilityName::FilePicker,
    CapabilityName::PhotoPicker,
    CapabilityName::GallerySave,
    CapabilityName::FileExport,
    CapabilityName::OutgoingShare,
    CapabilityName::FileOpen,
    CapabilityName::BatteryStatus,
    CapabilityName::NetworkStatus,
    CapabilityName::DiskSpace,
    CapabilityName::KeepScreenOn,
    CapabilityName::BackgroundExecution,
    CapabilityName::Lifecycle,
    CapabilityName::WebviewCache,
];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Support {
    Supported,
    Unsupported,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Implementation {
    Implemented,
    NotImplemented,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Authorization {
    NotRequired,
    Unknown,
    // Only native permission observations may produce these states.
    #[allow(dead_code)]
    Granted,
    #[allow(dead_code)]
    Denied,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum RuntimeAvailability {
    // Implementation availability does not establish current native runtime readiness.
    #[allow(dead_code)]
    Available,
    Unknown,
    Unavailable,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityStatus {
    pub support: Support,
    pub implementation: Implementation,
    pub authorization: Authorization,
    pub runtime: RuntimeAvailability,
}

impl CapabilityStatus {
    pub fn is_implemented(self) -> bool {
        self.support == Support::Supported && self.implementation == Implementation::Implemented
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlatformCapabilities {
    pub platform: Platform,
    pub features: BTreeMap<CapabilityName, CapabilityStatus>,
}

fn status_for(platform: Platform, name: CapabilityName) -> CapabilityStatus {
    use CapabilityName::*;
    let supported = match platform {
        Platform::Android => true,
        Platform::Ios => matches!(
            name,
            NativeInsets
                | FilePicker
                | PhotoPicker
                | FileExport
                | FileOpen
                | BatteryStatus
                | DiskSpace
                | KeepScreenOn
                | BackgroundExecution
                | Lifecycle
                | WebviewCache
        ),
        // Host scaffold is for development; its fixture values are never product capabilities.
        Platform::Host => false,
    };
    let implemented = platform == Platform::Android;
    let needs_authorization = matches!(
        name,
        AndroidPermissionGate
            | ApkUpdate
            | SystemNotifications
            | RootAccess
            | VoiceRecording
            | Camera
            | GallerySave
            | BackgroundExecution
    );
    CapabilityStatus {
        support: if supported {
            Support::Supported
        } else {
            Support::Unsupported
        },
        implementation: if implemented {
            Implementation::Implemented
        } else {
            Implementation::NotImplemented
        },
        authorization: if supported && needs_authorization {
            Authorization::Unknown
        } else {
            Authorization::NotRequired
        },
        runtime: if implemented {
            RuntimeAvailability::Unknown
        } else {
            RuntimeAvailability::Unavailable
        },
    }
}

pub fn is_implemented(name: CapabilityName) -> bool {
    status_for(current_platform(), name).is_implemented()
}

/// Protect effects even when an invoke bypasses its normal frontend entry.
pub fn require_capability(name: CapabilityName) -> Result<(), String> {
    let platform = current_platform();
    let status = status_for(platform, name);
    if status.support == Support::Unsupported {
        return Err(format!(
            "unsupported: {name:?} is unavailable on {platform:?}"
        ));
    }
    if status.implementation != Implementation::Implemented {
        return Err(format!(
            "not_implemented: {name:?} has no adapter on {platform:?}"
        ));
    }
    Ok(())
}

#[tauri::command]
pub fn get_platform_capabilities() -> Result<PlatformCapabilities, String> {
    let platform = current_platform();
    Ok(PlatformCapabilities {
        platform,
        features: CAPABILITIES
            .into_iter()
            .map(|name| (name, status_for(platform, name)))
            .collect(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ios_planned_adapter_does_not_report_success_or_permission_grants() {
        let picker = status_for(Platform::Ios, CapabilityName::FilePicker);
        assert_eq!(picker.support, Support::Supported);
        assert_eq!(picker.implementation, Implementation::NotImplemented);
        assert_eq!(picker.runtime, RuntimeAvailability::Unavailable);
        assert!(!picker.is_implemented());
        let updater = status_for(Platform::Ios, CapabilityName::ApkUpdate);
        assert_eq!(updater.support, Support::Unsupported);
    }

    #[test]
    fn android_implementation_is_not_a_permission_or_runtime_observation() {
        let camera = status_for(Platform::Android, CapabilityName::Camera);
        assert!(camera.is_implemented());
        assert_eq!(camera.authorization, Authorization::Unknown);
        assert_eq!(camera.runtime, RuntimeAvailability::Unknown);
    }

    #[test]
    fn host_does_not_advertise_native_fixture_values() {
        for name in CAPABILITIES {
            assert!(!status_for(Platform::Host, name).is_implemented());
        }
    }
}
