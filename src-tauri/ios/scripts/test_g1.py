"""Exercise generated-file ownership and write boundaries without Apple tools."""
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


class EngineeringFileTests(unittest.TestCase):
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


if __name__ == "__main__":
    unittest.main()
