// distributed/tools/location.rs
// [Streaming] MobileLocation — GPS position from Android native LocationManager.

use tauri::AppHandle;

use crate::distributed::streaming_scheduler::SensorDemand;
use crate::distributed::tool_registry::StreamingTool;
use crate::distributed::types::ToolManifest;

pub struct LocationTool;

impl StreamingTool for LocationTool {
    fn manifest(&self) -> ToolManifest {
        ToolManifest {
            name: "MobileLocation".to_string(),
            description: "按实际授权读取可得的坐标、定位精度、速度与海拔；结果可能为系统提供的大致位置，缺失字段明确说明。".to_string(),
            display_name: "GPS 地理定位".to_string(),
            placeholder: Some("{{MobileLocation}}".to_string()),
            invocation_commands: vec![],
        }
    }

    fn placeholder_key(&self) -> &str {
        "{{MobileLocation}}"
    }

    fn poll_interval_secs(&self) -> u64 {
        120
    }

    fn sensor_demand(&self) -> SensorDemand {
        SensorDemand::LOCATION
    }

    fn read_current(&self, app: &AppHandle) -> Result<String, String> {
        use tauri::Manager;
        let dist_state = app.state::<crate::distributed::DistributedState>();
        let loc = dist_state.telemetry.get_location_info(app);
        Ok(loc)
    }
}
