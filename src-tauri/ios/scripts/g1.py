#!/usr/bin/env python3
"""Replay G1 inputs on GitHub Actions; `check` is safe on any host."""
import argparse
import hashlib
import io
import json
import os
from pathlib import Path
import platform
import plistlib
import re
import shlex
import shutil
import struct
import subprocess
import sys
import urllib.request
import zipfile


ROOT = Path(__file__).resolve().parents[2]
REPO = ROOT.parent
IOS = ROOT / "ios"
APPLE = ROOT / "gen" / "apple"
INPUTS = json.loads((IOS / "g1-inputs.json").read_text(encoding="utf-8"))


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def digest(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def validate_scene(info):
    scene = info["UIApplicationSceneManifest"]
    require(scene["UIApplicationSupportsMultipleScenes"] is False, "Expected a single Scene")
    configurations = scene["UISceneConfigurations"]["UIWindowSceneSessionRoleApplication"]
    require(configurations == [{
        "UISceneConfigurationName": "TaoScene", "UISceneClassName": "UIWindowScene",
        "UISceneDelegateClassName": "TaoSceneDelegate",
    }], "Scene configuration does not match the audited tao delegate")


def icon_entries():
    entries = []
    for idiom, sizes in {
        "iphone": {"20x20": [2, 3], "29x29": [2, 3], "40x40": [2, 3], "60x60": [2, 3]},
        "ipad": {"20x20": [1, 2], "29x29": [1, 2], "40x40": [1, 2], "76x76": [1, 2], "83.5x83.5": [2]},
        "ios-marketing": {"1024x1024": [1]},
    }.items():
        for size, scales in sizes.items():
            for scale in scales:
                filename = "AppIcon-512@2x.png" if idiom == "ios-marketing" else f"AppIcon-{size}@{scale}x.png"
                data = (ROOT / "icons" / "ios" / filename).read_bytes()
                require(data[:8] == b"\x89PNG\r\n\x1a\n", f"Invalid PNG: {filename}")
                width, height = struct.unpack(">II", data[16:24])
                expected = int(float(size.split("x")[0]) * scale)
                require(width == height == expected, f"Icon dimensions do not match: {filename}")
                entries.append({"idiom": idiom, "size": size, "scale": f"{scale}x", "filename": filename})
    return entries


def check():
    config = json.loads((ROOT / "tauri.ios.conf.json").read_text(encoding="utf-8"))
    require(config["bundle"]["iOS"]["minimumSystemVersion"] == INPUTS["minimumOS"], "Minimum OS drift")
    package = json.loads((REPO / "package.json").read_text(encoding="utf-8"))
    require(package["devDependencies"]["@tauri-apps/cli"] == INPUTS["tauriCli"], "Re-audit the changed Tauri CLI")
    validate_scene(plistlib.loads((ROOT / "Info.ios.plist").read_bytes()))
    privacy = plistlib.loads((IOS / "PrivacyInfo.xcprivacy").read_bytes())
    require(privacy["NSPrivacyTracking"] is False, "Unexpected privacy tracking input")
    require(len(privacy["NSPrivacyAccessedAPITypes"]) > 0, "Missing privacy reasons")
    resolved = json.loads((IOS / "Package.resolved").read_text(encoding="utf-8"))
    require(len(resolved["pins"]) == 1 and resolved["pins"][0]["identity"] == "swift-rs", "Re-audit Swift dependencies")
    require(re.fullmatch(r"[0-9a-f]{40}", resolved["pins"][0]["state"]["revision"]), "Invalid Swift revision")
    swift_package = (ROOT / "plugins" / "vcp-mobile" / "ios" / "Package.swift").read_text(encoding="utf-8")
    require(INPUTS["minimumOS"] == "15.0" and ".iOS(.v15)" in swift_package, "Swift package minimum OS drift")
    require(f'.exact("{resolved["pins"][0]["state"]["version"]}")' in swift_package, "VCP Swift package pin differs from the shared lock")
    icons = icon_entries()
    print(f"G1 source inputs checked: minimum {INPUTS['minimumOS']}, single Scene, {len(icons)} icon slots")


def overlay(project_dir=APPLE):
    """Emit an additive XcodeGen spec; never rewrite the CLI-owned project.yml."""
    project_dir = Path(project_dir).resolve()
    require(project_dir.is_relative_to(APPLE.resolve()), "Overlay destination must stay in gen/apple")
    spec = project_dir / "project.yml"
    require(spec.is_file(), "Run tauri ios init before applying the overlay")
    source = spec.read_text(encoding="utf-8")
    match = re.search(r"(?m)^name:\s*([\w-]+)\s*$", source)
    require(match is not None, "CLI project name format changed")
    name = match[1]
    require(re.search(rf"(?m)^  {re.escape(name)}_iOS:\s*$", source), "Expected iOS target missing")
    privacy = project_dir / "VCPResources" / "PrivacyInfo.xcprivacy"
    privacy.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(IOS / "PrivacyInfo.xcprivacy", privacy)
    icon_dir = project_dir / "Assets.xcassets" / "AppIcon.appiconset"
    icon_dir.mkdir(parents=True, exist_ok=True)
    entries = icon_entries()
    for filename in {entry["filename"] for entry in entries}:
        shutil.copyfile(ROOT / "icons" / "ios" / filename, icon_dir / filename)
    write_json(icon_dir / "Contents.json", {"images": entries, "info": {"version": 1, "author": "xcode"}})
    output = project_dir / "project.vcp.json"
    write_json(output, {
        "include": ["project.yml"],
        "targets": {f"{name}_iOS": {
            "sources": [{"path": "VCPResources/PrivacyInfo.xcprivacy", "buildPhase": "resources"}],
            "settings": {"base": {
                "TARGETED_DEVICE_FAMILY": "1,2", "IPHONEOS_DEPLOYMENT_TARGET": INPUTS["minimumOS"],
                "ASSETCATALOG_COMPILER_APPICON_NAME": "AppIcon", "CODE_SIGNING_ALLOWED": "NO",
            }, "configs": {"debug": {"DEBUG_INFORMATION_FORMAT": "dwarf-with-dsym", "STRIP_INSTALLED_PRODUCT": "NO"}}},
        }},
    })
    return output


def run(command, *, env=None, log=None, cwd=REPO):
    print("+ " + shlex.join(str(item) for item in command), flush=True)
    if log is None:
        return subprocess.check_output(command, cwd=cwd, env=env, text=True, stderr=subprocess.STDOUT).strip()
    with log.open("w", encoding="utf-8") as stream:
        process = subprocess.Popen(command, cwd=cwd, env=env, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        for line in process.stdout:
            stream.write(line)
            print(line, end="", flush=True)
        code = process.wait()
    require(code == 0, f"Command failed ({code}); see {log.name}")
    return ""


def install_xcodegen(destination):
    package = INPUTS["xcodegen"]
    payload = urllib.request.urlopen(package["url"], timeout=120).read()
    require(hashlib.sha256(payload).hexdigest() == package["sha256"], "XcodeGen download SHA-256 mismatch")
    with zipfile.ZipFile(io.BytesIO(payload)) as archive:
        for entry in archive.infolist():
            target = (destination / entry.filename).resolve()
            require(target.is_relative_to(destination.resolve()), "XcodeGen archive path escapes destination")
            require((entry.external_attr >> 16) & 0o170000 != 0o120000, "Unexpected XcodeGen archive symlink")
        archive.extractall(destination)
    binary = destination / "xcodegen" / "bin" / "xcodegen"
    binary.chmod(0o755)
    return binary


def verify_archive(evidence, manifest, env):
    archives = list(APPLE.rglob("*.xcarchive"))
    require(len(archives) == 1, f"Expected one fresh device archive, found {len(archives)}")
    archive = archives[0]
    apps = list((archive / "Products" / "Applications").glob("*.app"))
    require(len(apps) == 1, "Archive must contain one main app")
    app = apps[0]
    info = plistlib.loads((app / "Info.plist").read_bytes())
    validate_scene(info)
    require(info["MinimumOSVersion"] == INPUTS["minimumOS"], "Built minimum OS mismatch")
    require(info["CFBundleIdentifier"] == "com.vcp.avatar", "Unexpected G1 Bundle ID")
    require(info["CFBundleSupportedPlatforms"] == ["iPhoneOS"], "Archive is not a device build")
    require(sorted(info["UIDeviceFamily"]) == [1, 2], "Expected iPhone and iPad support")
    require(not (app / "embedded.mobileprovision").exists(), "G1 must not embed a signing profile")
    require((app / "Assets.car").is_file(), "Compiled asset catalog missing")
    privacy_path = app / "PrivacyInfo.xcprivacy"
    require(privacy_path.is_file(), "PrivacyInfo.xcprivacy missing from app bundle root")
    require(plistlib.loads(privacy_path.read_bytes()) == plistlib.loads((IOS / "PrivacyInfo.xcprivacy").read_bytes()), "Bundled privacy input differs")
    binary = app / info["CFBundleExecutable"]
    architectures = run(["xcrun", "lipo", "-archs", str(binary)], env=env)
    require(architectures == "arm64", "Unexpected executable architectures")
    # @_cdecl can become a local/hidden defined symbol in the final image.
    # Exclude undefined symbols, but do not require external visibility (-g).
    symbols = set(run(["xcrun", "nm", "-U", "-j", str(binary)], env=env).splitlines())
    require("_init_plugin_vcp_mobile" in symbols, "VCP Swift registration definition missing from linked executable")
    (evidence / "registration-symbols.txt").write_text("\n".join(sorted(symbol for symbol in symbols if symbol.startswith("_init_plugin_"))) + "\n", encoding="utf-8")
    load_commands = run(["xcrun", "otool", "-l", str(binary)], env=env)
    require("LC_CODE_SIGNATURE" not in load_commands, "G1 executable unexpectedly has a code signature")
    (evidence / "macho-load-commands.txt").write_text(load_commands + "\n", encoding="utf-8")
    swift_evidence = [json.loads(p.read_text(encoding="utf-8")) for p in (evidence / "swiftpm").glob("*.json")]
    require({item["package"] for item in swift_evidence} == {"Tauri", "tauri-plugin-opener", "tauri-plugin-vcp-mobile"}, "SwiftPM gate was bypassed or a root was not built")
    expected_revision = json.loads((IOS / "Package.resolved").read_text(encoding="utf-8"))["pins"][0]["state"]["revision"]
    require(all(item.get("status") == "passed" and item.get("revision") == expected_revision for item in swift_evidence), "SwiftPM root evidence is incomplete")
    manifest.update({"bundleId": info["CFBundleIdentifier"], "architectures": architectures.split(), "codeSigning": "unsigned", "privacySha256": digest(privacy_path), "infoPlistSha256": digest(app / "Info.plist"), "swiftpm": swift_evidence})
    archive_zip = evidence / "G1-device-debug.xcarchive.zip"
    run(["ditto", "-c", "-k", "--sequesterRsrc", "--keepParent", str(archive), str(archive_zip)], env=env)
    manifest["archiveSha256"] = digest(archive_zip)
    (evidence / "SHA256SUMS").write_text(f"{manifest['archiveSha256']}  {archive_zip.name}\n", encoding="utf-8")


def build():
    require(sys.platform == "darwin" and os.environ.get("GITHUB_ACTIONS") == "true", "Apple builds are restricted to the manual GitHub Actions G1 entry")
    require(platform.machine() == INPUTS["runnerArchitecture"], "Unexpected runner architecture")
    require(not APPLE.exists(), "G1 requires a fresh checkout without gen/apple; no automatic deletion is performed")
    evidence = Path(os.environ["RUNNER_TEMP"]) / "vcp-ios-g1"
    evidence.mkdir(parents=True, exist_ok=False)
    manifest = {"gate": "G1", "status": "running", "target": "aarch64-apple-ios", "profile": "debug", "inputs": INPUTS, "commit": run(["git", "rev-parse", "HEAD"]), "runId": os.environ.get("GITHUB_RUN_ID"), "runAttempt": os.environ.get("GITHUB_RUN_ATTEMPT"), "imageOS": os.environ.get("ImageOS"), "imageVersion": os.environ.get("ImageVersion"), "minimumOS": INPUTS["minimumOS"]}
    try:
        env = os.environ.copy()
        env["DEVELOPER_DIR"] = INPUTS["developerDir"]
        require(Path(env["DEVELOPER_DIR"]).is_dir(), "Pinned Xcode is absent from this image")
        manifest["xcode"] = run(["xcodebuild", "-version"], env=env)
        require(manifest["xcode"] == f"Xcode {INPUTS['xcodeVersion']}\nBuild version {INPUTS['xcodeBuild']}", "Pinned Xcode version/build mismatch")
        manifest["sdkVersion"] = run(["xcrun", "--sdk", "iphoneos", "--show-sdk-version"], env=env)
        require(manifest["sdkVersion"] == INPUTS["iphoneosSdk"], "Pinned iPhoneOS SDK mismatch")
        manifest["simulatorRuntimes"] = json.loads(run(["xcrun", "simctl", "list", "runtimes", "--json"], env=env))
        require(any(item.get("isAvailable") and "iOS" in item.get("name", "") for item in manifest["simulatorRuntimes"]["runtimes"]), "Tauri CLI device-build precheck needs an installed iOS runtime")
        manifest["macOS"] = run(["sw_vers"], env=env)
        for tool, expected in [("node", "v" + INPUTS["node"]), ("pnpm", INPUTS["pnpm"])]:
            manifest[tool] = run([tool, "--version"], env=env)
            require(manifest[tool] == expected, f"Unexpected {tool} version")
        manifest["rust"] = run(["rustc", "--version"], env=env)
        manifest["tauriCli"] = run(["pnpm", "exec", "tauri", "--version"], env=env)
        require(manifest["tauriCli"] == "tauri-cli " + INPUTS["tauriCli"], "Installed Tauri CLI mismatch")
        env.update({"IPHONEOS_DEPLOYMENT_TARGET": INPUTS["minimumOS"], "SDKROOT": run(["xcrun", "--sdk", "iphoneos", "--show-sdk-path"], env=env), "CARGO_PROFILE_DEV_DEBUG": "1", "CARGO_PROFILE_DEV_STRIP": "false", "CARGO_INCREMENTAL": "0", "CARGO_BUILD_JOBS": "2"})
        # These overrides select different native-library or signing paths; keep them absent.
        for key in ["LIBSQLITE3_SYS_USE_PKG_CONFIG", "ZSTD_SYS_USE_PKG_CONFIG", "RING_PREGENERATE_ASM", "APPLE_DEVELOPMENT_TEAM", "IOS_CERTIFICATE", "IOS_CERTIFICATE_PASSWORD", "IOS_MOBILE_PROVISION", "APPLE_CERTIFICATE", "APPLE_CERTIFICATE_PASSWORD", "APPLE_PROVISIONING_PROFILE", "APPLE_API_KEY", "APPLE_API_KEY_PATH", "APPLE_API_ISSUER"]:
            env.pop(key, None)
        env["CC_aarch64_apple_ios"] = run(["xcrun", "--sdk", "iphoneos", "--find", "clang"], env=env)
        env["CXX_aarch64_apple_ios"] = run(["xcrun", "--sdk", "iphoneos", "--find", "clang++"], env=env)
        env["AR_aarch64_apple_ios"] = run(["xcrun", "--find", "ar"], env=env)
        manifest["nativeEnvironment"] = {key: env.get(key) for key in ["SDKROOT", "IPHONEOS_DEPLOYMENT_TARGET", "CC_aarch64_apple_ios", "CXX_aarch64_apple_ios", "AR_aarch64_apple_ios", "CARGO_PROFILE_DEV_DEBUG", "CARGO_PROFILE_DEV_STRIP", "LIBSQLITE3_SYS_USE_PKG_CONFIG", "ZSTD_SYS_USE_PKG_CONFIG", "RING_PREGENERATE_ASM"]}
        xcodegen = install_xcodegen(evidence / "tools")
        env["PATH"] = str(xcodegen.parent) + os.pathsep + env["PATH"]
        manifest["xcodegen"] = run([str(xcodegen), "--version"], env=env)
        require(INPUTS["xcodegen"]["version"] in manifest["xcodegen"], "XcodeGen version mismatch")
        run(["rustup", "target", "add", "aarch64-apple-ios"], env=env, log=evidence / "rust-target.log")
        run(["pnpm", "tauri", "ios", "init", "--ci", "--skip-targets-install"], env=env, log=evidence / "init.log")
        spec = overlay()
        run([str(xcodegen), "generate", "--spec", str(spec)], env=env, log=evidence / "overlay.log")
        shim_dir = evidence / "swift-shim"
        shim_dir.mkdir()
        env["TAURI_VCP_REAL_SWIFT"] = run(["xcrun", "--find", "swift"], env=env)
        manifest["swiftExecutable"] = env["TAURI_VCP_REAL_SWIFT"]
        manifest["swiftVersion"] = run([env["TAURI_VCP_REAL_SWIFT"], "--version"], env=env)
        env["TAURI_VCP_SWIFT_LOCK"] = str(IOS / "Package.resolved")
        env["TAURI_VCP_SWIFT_EVIDENCE"] = str(evidence / "swiftpm")
        shim = shim_dir / "swift"
        shim.write_text("#!/bin/sh\nexec " + shlex.join([sys.executable, str(IOS / "scripts" / "swift-lock.py")]) + ' "$@"\n', encoding="utf-8")
        shim.chmod(0o755)
        env["PATH"] = str(shim_dir) + os.pathsep + env["PATH"]
        manifest["inputHashes"] = {str(path.relative_to(REPO)): digest(path) for path in [ROOT / "tauri.conf.json", ROOT / "tauri.ios.conf.json", ROOT / "Info.ios.plist", ROOT / "Cargo.lock", REPO / "pnpm-lock.yaml", IOS / "Package.resolved", IOS / "PrivacyInfo.xcprivacy", *sorted((ROOT / "capabilities").glob("*.json"))]}
        # Tauri owns the one frontend build via beforeBuildCommand.
        run(["pnpm", "tauri", "ios", "build", "--debug", "--target", "aarch64", "--archive-only", "--no-sign", "--ci", "--", "--locked"], env=env, log=evidence / "build.log")
        verify_archive(evidence, manifest, env)
        manifest["status"] = "passed"
    except Exception as error:
        manifest.update({"status": "failed", "error": str(error)})
        raise
    finally:
        write_json(evidence / "ios-build-manifest.json", manifest)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["check", "overlay", "build"])
    args = parser.parse_args()
    try:
        check()
        if args.command == "overlay":
            print(overlay())
        elif args.command == "build":
            build()
    except (OSError, KeyError, ValueError, RuntimeError, subprocess.SubprocessError) as error:
        print(f"G1: {error}", file=sys.stderr)
        sys.exit(1)
