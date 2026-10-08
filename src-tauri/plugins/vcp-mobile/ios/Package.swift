// swift-tools-version:5.5
import PackageDescription

let package = Package(
    name: "tauri-plugin-vcp-mobile",
    platforms: [.iOS(.v15)],
    products: [
        .library(
            name: "tauri-plugin-vcp-mobile",
            type: .static,
            targets: ["tauri-plugin-vcp-mobile"]
        )
    ],
    dependencies: [
        .package(name: "Tauri", path: "../.tauri/tauri-api"),
        // Cargo.lock does not constrain the Swift package resolver. Rust swift-rs
        // 1.0.8 keeps the Swift sources from the published SwiftPM 1.0.7 tag.
        .package(
            name: "SwiftRs",
            url: "https://github.com/Brendonovich/swift-rs",
            .exact("1.0.7")
        )
    ],
    targets: [
        .target(
            name: "tauri-plugin-vcp-mobile",
            dependencies: [.byName(name: "Tauri"), .byName(name: "SwiftRs")],
            path: "Sources"
        )
    ]
)
