#!/usr/bin/env python3
"""G1-only SwiftPM gate, including Tauri/opener's independent build roots."""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys


EXPECTED_ROOTS = {"Tauri", "tauri-plugin-opener", "tauri-plugin-vcp-mobile"}
OPENER_254_LOCK_SHA256 = "daf0cdf825417e400e2898d47c1de6912a112265f0fb14c056f46735e728b9c8"


def validate_resolution(actual, expected):
    # Swift 6 may rewrite the format/originHash; compare the meaningful SCM input.
    if actual.get("pins") != expected["pins"]:
        raise RuntimeError("SwiftPM resolution differs from ios/Package.resolved")


def seed_resolution(package_root, package_name, expected_path):
    expected = json.loads(expected_path.read_text(encoding="utf-8"))
    resolved = package_root / "Package.resolved"
    migration = None
    if resolved.exists():
        original = resolved.read_bytes()
        original_sha = hashlib.sha256(original).hexdigest()
        # opener 2.5.4 ships this exact v1 SwiftRs 1.0.6 lock. Migrate this
        # audited build input only; an arbitrary stale/changed lock still fails.
        if (package_name == "tauri-plugin-opener"
                and package_root.parent.name == "tauri-plugin-opener-2.5.4"
                and original_sha == OPENER_254_LOCK_SHA256):
            migration = {"originalSha256": original_sha, "originalResolved": json.loads(original)}
            resolved.write_bytes(expected_path.read_bytes())
        else:
            validate_resolution(json.loads(original), expected)
    else:
        # Only build resolution metadata is added; dependency source manifests stay intact.
        resolved.write_bytes(expected_path.read_bytes())
    return expected, resolved, migration


def main():
    real_swift = os.environ["TAURI_VCP_REAL_SWIFT"]
    args = sys.argv[1:]
    if not args or args[0] != "build":
        return subprocess.call([real_swift, *args])
    package_root = Path.cwd().resolve()
    manifest = (package_root / "Package.swift").read_text(encoding="utf-8")
    match = re.search(r'let\s+package\s*=\s*Package\(\s*name:\s*"([^"]+)"', manifest)
    if not match or match[1] not in EXPECTED_ROOTS:
        raise RuntimeError(f"Unaudited Swift build root: {package_root}")
    if "--package-path" in args or "--build-path" not in args:
        raise RuntimeError("Swift build invocation changed; re-audit swift-rs")
    expected_path = Path(os.environ["TAURI_VCP_SWIFT_LOCK"])
    expected, resolved, migration = seed_resolution(package_root, match[1], expected_path)
    evidence = Path(os.environ["TAURI_VCP_SWIFT_EVIDENCE"])
    evidence.mkdir(parents=True, exist_ok=True)
    identity = hashlib.sha256(str(package_root).encode()).hexdigest()[:12]
    record_path = evidence / f"{match[1]}-{identity}.json"
    record = {
        "package": match[1], "root": str(package_root), "status": "building",
        "upstreamLockMigration": migration,
        "manifestSha256": hashlib.sha256(manifest.encode()).hexdigest(),
    }
    # Preserve the old upstream lock even when the following Swift build fails.
    record_path.write_text(json.dumps(record, indent=2) + "\n", encoding="utf-8")
    code = subprocess.call([real_swift, *args, "--force-resolved-versions"])
    if code:
        record.update({"status": "failed", "exitCode": code})
        record_path.write_text(json.dumps(record, indent=2) + "\n", encoding="utf-8")
        return code
    validate_resolution(json.loads(resolved.read_text(encoding="utf-8")), expected)
    build_path = Path(args[args.index("--build-path") + 1]).resolve()
    checkout = build_path / "checkouts" / "swift-rs"
    revision = subprocess.check_output(
        ["git", "-C", str(checkout), "rev-parse", "HEAD"], text=True
    ).strip()
    if revision != expected["pins"][0]["state"]["revision"]:
        raise RuntimeError("SwiftRs checkout HEAD does not match the controlled revision")
    record.update({"status": "passed", "revision": revision, "resolved": json.loads(resolved.read_text(encoding="utf-8"))})
    record_path.write_text(json.dumps(record, indent=2) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (KeyError, OSError, ValueError, RuntimeError, subprocess.SubprocessError) as error:
        print(f"SwiftPM input gate: {error}", file=sys.stderr)
        sys.exit(1)
