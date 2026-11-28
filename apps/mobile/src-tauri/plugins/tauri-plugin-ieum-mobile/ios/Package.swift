// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "tauri-plugin-ieum-mobile",
    platforms: [
        .iOS(.v15),
    ],
    products: [
        .library(
            name: "tauri-plugin-ieum-mobile",
            type: .static,
            targets: ["tauri-plugin-ieum-mobile"]
        ),
    ],
    dependencies: [
        .package(name: "Tauri", path: "../.tauri/tauri-api"),
    ],
    targets: [
        .target(
            name: "tauri-plugin-ieum-mobile",
            dependencies: [
                .byName(name: "Tauri"),
            ],
            path: "Sources"
        ),
    ]
)
