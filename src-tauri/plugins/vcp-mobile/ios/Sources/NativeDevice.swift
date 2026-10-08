import Darwin
import Foundation
import Metal
import Network
import Tauri
import UIKit
import os

private struct BatterySnapshot: Encodable {
    let level: Int?
    let isPowerSaveMode: Bool
    let status: String?
    let temperature: Double? = nil
    let unavailable: [String: String]
}

private struct DiskSnapshot: Encodable {
    let freeBytes: UInt64
    let freeGb: Double
    let totalBytes: UInt64
    let totalGb: Double
    let volume = "app_home_volume"
    // The existing *Gb wire names use binary GiB, like the Android consumer.
}

private struct DeviceSnapshot: Encodable {
    let model: String
    let systemName: String
    let systemVersion: String
    let architecture: String
    let hardwareIdentifier: String?
    let processorCount: Int
    let activeProcessorCount: Int
    let cpuUsagePercent: Double?
    let physicalMemoryBytes: UInt64
    let processResidentMemoryBytes: UInt64?
    let processAvailableMemoryBytes: UInt64
    let thermalState: String
    let unavailable: [String: String]
}

private struct ThermalSnapshot: Encodable {
    let status: String
}

private struct GpuSnapshot: Encodable {
    let renderer: String
    // Existing field describes unavailable utilization, not failure to read the name.
    let restricted = true
    let unavailable = ["usagePercent": "iOS 不提供全机 GPU 实时利用率接口"]
}

private struct NetworkSnapshot: Encodable {
    let connected: Bool
    let type: String
    let downSpeedKbps: Int? = nil
    let upSpeedKbps: Int? = nil
    let ip: String?
    let isExpensive: Bool
    let isConstrained: Bool
    let unavailable: [String: String]
}

private enum NativeDevice {
    // The CPU baseline belongs to the native process and is accessed only on main.
    private static var previousCpuTicks: [UInt32]?

    static func battery() -> BatterySnapshot {
        dispatchPrecondition(condition: .onQueue(.main))
        let device = UIDevice.current
        // The process owns battery monitoring after the first real consumer.
        // Turning it off after each read can discard the asynchronously populated
        // value and leave every subsequent snapshot unknown. There are no retained
        // callbacks, and WebView/plugin replacement does not interrupt this source.
        if !device.isBatteryMonitoringEnabled { device.isBatteryMonitoringEnabled = true }
        let charge = device.batteryLevel
        let level = charge.isFinite && charge >= 0 && charge <= 1
            ? Int((charge * 100).rounded()) : nil
        let status: String?
        switch device.batteryState {
        case .charging: status = "充电中"
        case .full: status = "已充满"
        case .unplugged: status = "未充电"
        case .unknown: status = nil
        @unknown default: status = nil
        }
        var missing = ["temperature": "iOS 未公开电池温度"]
        if level == nil { missing["level"] = "系统尚未提供电量读数" }
        if status == nil { missing["status"] = "系统尚未提供充电状态" }
        return BatterySnapshot(
            level: level, isPowerSaveMode: ProcessInfo.processInfo.isLowPowerModeEnabled,
            status: status, unavailable: missing
        )
    }

    static func disk() throws -> DiskSnapshot {
        // This is the capacity of the volume containing the sandbox, not a sandbox quota.
        let home = URL(fileURLWithPath: NSHomeDirectory(), isDirectory: true)
        let values = try home.resourceValues(forKeys: [
            .volumeAvailableCapacityKey, .volumeTotalCapacityKey
        ])
        guard let free = values.volumeAvailableCapacity, free >= 0,
              let total = values.volumeTotalCapacity, total > 0 else {
            throw NSError(domain: "VcpMobileDisk", code: 1, userInfo: [
                NSLocalizedDescriptionKey: "应用所在卷未返回有效容量"
            ])
        }
        let gib = 1_073_741_824.0
        return DiskSnapshot(
            freeBytes: UInt64(free), freeGb: Double(free) / gib,
            totalBytes: UInt64(total), totalGb: Double(total) / gib
        )
    }

    static func thermal() -> String {
        switch ProcessInfo.processInfo.thermalState {
        case .nominal: return "正常"
        case .fair: return "轻度发热"
        case .serious: return "严重发热"
        case .critical: return "临界热状态"
        @unknown default: return "未知热状态"
        }
    }

    static func snapshot() -> DeviceSnapshot {
        dispatchPrecondition(condition: .onQueue(.main))
        let process = ProcessInfo.processInfo
        var missing = [
            "cpuFrequencyHz": "iOS 未公开可靠的当前 CPU 频率",
            "cpuTemperatureCelsius": "iOS 只提供热状态等级，不提供 CPU 摄氏温度",
            "systemAvailableMemoryBytes": "App 剩余内存预算不能表示全机可用内存"
        ]
        let cpu = cpuUsage(unavailable: &missing)
        var system = utsname()
        let hardware: String?
        if uname(&system) == 0 {
            let machineCapacity = MemoryLayout.size(ofValue: system.machine)
            hardware = withUnsafePointer(to: &system.machine) {
                $0.withMemoryRebound(to: CChar.self, capacity: machineCapacity) {
                    String(cString: $0)
                }
            }
        } else {
            hardware = nil
            missing["hardwareIdentifier"] = "uname 读取失败"
        }
        #if arch(arm64)
        let architecture = "aarch64"
        #elseif arch(x86_64)
        let architecture = "x86_64"
        #else
        let architecture = "unknown"
        #endif
        var memory = mach_task_basic_info_data_t()
        let memoryCount = MemoryLayout<mach_task_basic_info_data_t>.size / MemoryLayout<integer_t>.size
        var count = mach_msg_type_number_t(memoryCount)
        let result = withUnsafeMutablePointer(to: &memory) {
            $0.withMemoryRebound(to: integer_t.self, capacity: memoryCount) {
                task_info(mach_task_self_, task_flavor_t(MACH_TASK_BASIC_INFO), $0, &count)
            }
        }
        let resident: UInt64?
        if result == KERN_SUCCESS {
            resident = UInt64(memory.resident_size)
        } else {
            resident = nil
            missing["processResidentMemoryBytes"] = "task_info 读取失败: \(result)"
        }
        return DeviceSnapshot(
            model: UIDevice.current.model, systemName: UIDevice.current.systemName,
            systemVersion: UIDevice.current.systemVersion, architecture: architecture,
            hardwareIdentifier: hardware, processorCount: process.processorCount,
            activeProcessorCount: process.activeProcessorCount, cpuUsagePercent: cpu,
            physicalMemoryBytes: process.physicalMemory, processResidentMemoryBytes: resident,
            processAvailableMemoryBytes: UInt64(os_proc_available_memory()),
            thermalState: thermal(), unavailable: missing
        )
    }

    private static func cpuUsage(unavailable: inout [String: String]) -> Double? {
        var info = host_cpu_load_info_data_t()
        let capacity = MemoryLayout<host_cpu_load_info_data_t>.size / MemoryLayout<integer_t>.size
        var count = mach_msg_type_number_t(capacity)
        let host = mach_host_self()
        defer { mach_port_deallocate(mach_task_self_, host) }
        let result = withUnsafeMutablePointer(to: &info) {
            $0.withMemoryRebound(to: integer_t.self, capacity: capacity) {
                host_statistics(host, host_flavor_t(HOST_CPU_LOAD_INFO), $0, &count)
            }
        }
        guard result == KERN_SUCCESS else {
            previousCpuTicks = nil
            unavailable["cpuUsagePercent"] = "host_statistics 读取失败: \(result)"
            return nil
        }
        let ticks = [info.cpu_ticks.0, info.cpu_ticks.1, info.cpu_ticks.2, info.cpu_ticks.3]
        let previous = previousCpuTicks
        previousCpuTicks = ticks
        guard let previous = previous else {
            unavailable["cpuUsagePercent"] = "首次快照；需后续快照计算区间利用率"
            return nil
        }
        // Mach counters are unsigned 32-bit values; wrapping subtraction handles rollover.
        let deltas = zip(ticks, previous).map { pair in UInt64(pair.0 &- pair.1) }
        let total = deltas.reduce(0, +)
        guard total > 0 else {
            unavailable["cpuUsagePercent"] = "两次快照间没有新增 CPU 计数"
            return nil
        }
        return Double(total - deltas[Int(CPU_STATE_IDLE)]) / Double(total) * 100
    }
}

// A one-shot monitor owns its deadline and never reads the unevaluated currentPath.
// Completion and timeout are serialized on main; the deadline retains the request
// until a real callback or timeout, independently of the Rust caller's lifetime.
private final class NativeNetworkRequest {
    private var invoke: Invoke?
    private var monitor: NWPathMonitor?
    private var deadline: DispatchWorkItem?
    private let queue = DispatchQueue(label: "com.vcp.avatar.network-snapshot")

    init(_ invoke: Invoke) { self.invoke = invoke }

    func start() {
        let monitor = NWPathMonitor()
        self.monitor = monitor
        monitor.pathUpdateHandler = { [weak self] path in
            DispatchQueue.main.async { self?.complete(path) }
        }
        let deadline = DispatchWorkItem { [self] in finishError("network_timeout: 未收到网络路径快照") }
        self.deadline = deadline
        DispatchQueue.main.asyncAfter(deadline: .now() + 2, execute: deadline)
        monitor.start(queue: queue)
    }

    private func takeInvoke() -> Invoke? {
        dispatchPrecondition(condition: .onQueue(.main))
        let current = invoke
        invoke = nil
        monitor?.cancel()
        monitor?.pathUpdateHandler = nil
        monitor = nil
        deadline?.cancel()
        deadline = nil
        return current
    }

    private func finishError(_ message: String) { takeInvoke()?.reject(message) }

    private func complete(_ path: NWPath) {
        guard let invoke = takeInvoke() else { return }
        let connected = path.status == .satisfied
        var types: [String] = []
        if path.usesInterfaceType(.wifi) { types.append("Wi-Fi") }
        if path.usesInterfaceType(.cellular) { types.append("蜂窝网络") }
        if path.usesInterfaceType(.wiredEthernet) { types.append("以太网") }
        if path.usesInterfaceType(.other) { types.append("其他接口") }
        let interfaces = Set(path.availableInterfaces.filter { path.usesInterfaceType($0.type) }.map { $0.name })
        let ip = connected ? Self.addresses(interfaces).joined(separator: ", ") : ""
        var missing = [
            "downSpeedKbps": "NWPath 不提供链路下行速率",
            "upSpeedKbps": "NWPath 不提供链路上行速率",
            "serverReachability": "路径可用不代表服务器可达"
        ]
        if ip.isEmpty { missing["ip"] = connected ? "未取得活动接口地址" : "当前没有可用网络路径" }
        invoke.resolve(NetworkSnapshot(
            connected: connected, type: types.isEmpty ? "无可用接口" : types.joined(separator: "/"),
            ip: ip.isEmpty ? nil : ip, isExpensive: path.isExpensive,
            isConstrained: path.isConstrained, unavailable: missing
        ))
    }

    private static func addresses(_ names: Set<String>) -> [String] {
        var head: UnsafeMutablePointer<ifaddrs>?
        guard getifaddrs(&head) == 0 else { return [] }
        defer { freeifaddrs(head) }
        var addresses: [String] = []
        var cursor = head
        while let current = cursor {
            defer { cursor = current.pointee.ifa_next }
            let item = current.pointee
            guard let address = item.ifa_addr, names.contains(String(cString: item.ifa_name)),
                  item.ifa_flags & UInt32(IFF_UP) != 0,
                  item.ifa_flags & UInt32(IFF_LOOPBACK) == 0,
                  address.pointee.sa_family == UInt8(AF_INET) || address.pointee.sa_family == UInt8(AF_INET6)
            else { continue }
            var buffer = [CChar](repeating: 0, count: Int(NI_MAXHOST))
            let bufferCapacity = socklen_t(buffer.count)
            if getnameinfo(address, socklen_t(address.pointee.sa_len), &buffer,
                           bufferCapacity, nil, 0, NI_NUMERICHOST) == 0 {
                addresses.append(String(cString: buffer))
            }
        }
        return Array(Set(addresses)).sorted()
    }
}

extension VcpMobilePlugin {
    @objc public func getBatteryStatus(_ invoke: Invoke) {
        DispatchQueue.main.async { invoke.resolve(NativeDevice.battery()) }
    }

    @objc public func getFreeDiskSpace(_ invoke: Invoke) {
        DispatchQueue.global(qos: .utility).async {
            do { invoke.resolve(try NativeDevice.disk()) }
            catch { invoke.reject("disk_query_failed: \(error.localizedDescription)") }
        }
    }

    @objc public func getDeviceSnapshot(_ invoke: Invoke) {
        DispatchQueue.main.async { invoke.resolve(NativeDevice.snapshot()) }
    }

    @objc public func getCpuThermalStatus(_ invoke: Invoke) {
        invoke.resolve(ThermalSnapshot(status: NativeDevice.thermal()))
    }

    @objc public func getGpuStatus(_ invoke: Invoke) {
        guard let device = MTLCreateSystemDefaultDevice() else {
            invoke.reject("gpu_unavailable: 未取得 Metal 设备")
            return
        }
        invoke.resolve(GpuSnapshot(renderer: device.name))
    }

    @objc public func getNetworkStatus(_ invoke: Invoke) {
        DispatchQueue.main.async { NativeNetworkRequest(invoke).start() }
    }
}
