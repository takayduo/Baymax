import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

# Avoid unrelated DLLs from development tools on PATH shadowing Qt's system ICU.
if os.name == "nt":
    os.environ["PATH"] = os.environ["SystemRoot"] + "\\System32;" + os.environ["SystemRoot"]
os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "engine"))
from PyQt6.QtWidgets import QApplication
from PyQt6.QtGui import QImage, QPainter
from PyQt6.QtCore import Qt, QByteArray
from PyQt6.QtSvg import QSvgRenderer
from core import avatar


class CompanionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app = QApplication.instance() or QApplication([])

    def test_catalog_renders_all_twenty_unique_hud_portraits(self):
        pictures = []
        for character in avatar.CATALOG:
            _, style = avatar.appearance({"avatarId": character["id"]})
            renderer = QSvgRenderer(QByteArray(avatar.body_svg(character, style)))
            self.assertTrue(renderer.isValid(), character["id"])
            image = QImage(128, 128, QImage.Format.Format_ARGB32)
            image.fill(Qt.GlobalColor.transparent)
            painter = QPainter(image); renderer.render(painter); painter.end()
            data = image.constBits(); data.setsize(image.sizeInBytes())
            pictures.append(bytes(data))
        self.assertEqual(len(set(pictures)), 20)

    def test_preferences_refresh_without_restarting_voice_and_survive_partial_writes(self):
        audit = Path(__file__).resolve().parents[1] / "audit"
        with tempfile.TemporaryDirectory(dir=audit, prefix="hud-test-") as folder, patch.object(avatar, "data_root", return_value=Path(folder)):
            self.assertTrue(Path(folder).resolve().is_relative_to(audit.resolve()))
            file = Path(folder) / "config" / "api_keys.json"; file.parent.mkdir()
            file.write_text(json.dumps({"companion": {"avatarId": "nori", "styles": {"nori": {"color": "#f0a6ca", "accessory": "bow"}}}}))
            actor = avatar.HoloAvatar()
            self.assertEqual(actor.avatar["id"], "nori"); self.assertEqual(actor.style["color"], "#F0A6CA")
            file.write_text('{')
            actor._load_preferences()
            self.assertEqual(actor.avatar["id"], "nori")
            file.write_text(json.dumps({"companion": {"avatarId": "atlas"}}))
            for _ in range(12): actor.step(.1, 0)
            self.assertEqual(actor.avatar["id"], "atlas")

    def test_voice_mouth_responds_only_to_assistant_speech(self):
        with patch.object(Path, "read_text", side_effect=FileNotFoundError):
            actor = avatar.HoloAvatar()
            actor.step(.1, .9, speaking=False); self.assertEqual(actor._mouth, 0)
            actor.step(.1, .9, speaking=True); self.assertGreater(actor._mouth, .5)
            actor.step(.1, .9, speaking=True, muted=True); self.assertLess(actor._mouth, .1)

    def test_malformed_styles_use_defaults(self):
        character, style = avatar.appearance({"avatarId": "../unknown", "styles": {"sprout": {"color": "<svg>", "accent": "#123", "accessory": "unknown"}}})
        self.assertEqual(character["id"], "puff"); self.assertEqual(style["color"], character["color"])
        self.assertEqual(style["accent"], character["accent"]); self.assertEqual(style["accessory"], "none")


if __name__ == "__main__":
    unittest.main()
