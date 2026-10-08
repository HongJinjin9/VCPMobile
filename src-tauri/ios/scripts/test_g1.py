"""Host checks for replay and dependency-input rejection; no Apple tools run."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(filename))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


g1 = load("g1", "g1.py")
swift_lock = load("swift_lock", "swift-lock.py")


class AppleInputTests(unittest.TestCase):
    def test_known_opener_lock_is_migrated_with_original_evidence(self):
        original = {
            "object": {"pins": [{"package": "SwiftRs", "repositoryURL": "https://github.com/Brendonovich/swift-rs", "state": {
                "branch": None, "revision": "b5ed223fcdab165bc21219c1925dc1e77e2bef5e", "version": "1.0.6",
            }}]}, "version": 1,
        }
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / "tauri-plugin-opener-2.5.4" / "ios"
            root.mkdir(parents=True)
            (root / "Package.resolved").write_bytes((json.dumps(original, indent=2) + "\n").encode())
            expected, resolved, migration = swift_lock.seed_resolution(root, "tauri-plugin-opener", g1.IOS / "Package.resolved")
            self.assertEqual(migration["originalResolved"], original)
            self.assertEqual(json.loads(resolved.read_bytes()), expected)

    def test_unknown_old_resolution_is_rejected_without_overwrite(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / "tauri-plugin-opener-2.5.4" / "ios"
            root.mkdir(parents=True)
            resolved = root / "Package.resolved"
            original = b'{"version":1,"object":{"pins":[]}}'
            resolved.write_bytes(original)
            with self.assertRaisesRegex(RuntimeError, "differs"):
                swift_lock.seed_resolution(root, "tauri-plugin-opener", g1.IOS / "Package.resolved")
            self.assertEqual(resolved.read_bytes(), original)

    def test_overlay_replays_without_changing_cli_spec_or_duplicating_resources(self):
        with tempfile.TemporaryDirectory() as temporary:
            project = Path(temporary) / "apple"
            project.mkdir()
            source = "name: vcp-mobile\ntargets:\n  vcp-mobile_iOS:\n    platform: iOS\n"
            (project / "project.yml").write_text(source, encoding="utf-8")
            with patch.object(g1, "APPLE", project):
                output = g1.overlay(project)
                first = output.read_bytes()
                g1.overlay(project)
                self.assertEqual(first, output.read_bytes())
            self.assertEqual((project / "project.yml").read_text(encoding="utf-8"), source)
            overlay = json.loads(first)
            self.assertEqual(overlay["include"], ["project.yml"])
            self.assertEqual(len(overlay["targets"]["vcp-mobile_iOS"]["sources"]), 1)
            self.assertEqual(g1.digest(project / "VCPResources" / "PrivacyInfo.xcprivacy"), g1.digest(g1.IOS / "PrivacyInfo.xcprivacy"))

    def test_overlay_rejects_outside_generated_tree(self):
        with tempfile.TemporaryDirectory() as temporary:
            with patch.object(g1, "APPLE", Path(temporary) / "apple"):
                with self.assertRaisesRegex(RuntimeError, "must stay in gen/apple"):
                    g1.overlay(temporary)

    def test_overlay_rejects_changed_cli_target(self):
        with tempfile.TemporaryDirectory() as temporary:
            project = Path(temporary)
            (project / "project.yml").write_text("name: vcp-mobile\ntargets:\n  other_iOS:\n", encoding="utf-8")
            with patch.object(g1, "APPLE", project):
                with self.assertRaisesRegex(RuntimeError, "target missing"):
                    g1.overlay(project)

    def test_multiple_scene_input_is_rejected(self):
        with self.assertRaisesRegex(RuntimeError, "single Scene"):
            g1.validate_scene({"UIApplicationSceneManifest": {"UIApplicationSupportsMultipleScenes": True}})

    def test_swift_resolution_rejects_different_revision_and_extra_dependencies(self):
        expected = json.loads((g1.IOS / "Package.resolved").read_text(encoding="utf-8"))
        changed = json.loads(json.dumps(expected))
        changed["pins"][0]["state"]["revision"] = "0" * 40
        with self.assertRaisesRegex(RuntimeError, "differs"):
            swift_lock.validate_resolution(changed, expected)
        changed = json.loads(json.dumps(expected))
        changed["pins"].append(changed["pins"][0])
        with self.assertRaisesRegex(RuntimeError, "differs"):
            swift_lock.validate_resolution(changed, expected)

    def test_swift_resolution_accepts_format_upgrade_without_changing_pins(self):
        expected = json.loads((g1.IOS / "Package.resolved").read_text(encoding="utf-8"))
        upgraded = {**expected, "version": 3, "originHash": "SwiftPM-owned"}
        swift_lock.validate_resolution(upgraded, expected)


if __name__ == "__main__":
    unittest.main()
