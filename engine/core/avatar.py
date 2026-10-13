"""Original Baymax wardrobe renderer for the optional Qt voice HUD.

Uses the same vector catalog and saved preferences as the desktop companion.
No downloaded meshes or third-party avatar runtime are required.
"""
from __future__ import annotations
import json
import math
import re
from pathlib import Path
from xml.sax.saxutils import escape
from PyQt6.QtCore import QByteArray, QPointF, QRectF, Qt
from PyQt6.QtGui import QColor, QIcon, QPainter, QPen, QPixmap
from PyQt6.QtSvg import QSvgRenderer
from PyQt6.QtWidgets import QApplication
from core.paths import data_root, resource_root


def catalog_folder() -> Path:
    bundled = resource_root() / "companions"
    return bundled if bundled.is_dir() else resource_root().parent / "public" / "companions"


CATALOG = json.loads((catalog_folder() / "catalog.json").read_text(encoding="utf-8"))
ACCESSORIES = json.loads((catalog_folder() / "accessories.json").read_text(encoding="utf-8"))


def shade(value: str, amount: float) -> str:
    values = [int(value[i:i + 2], 16) for i in (1, 3, 5)]
    return "#" + "".join(f"{round(v + ((255 if amount > 0 else 0) - v) * abs(amount)):02x}" for v in values)


def appearance(value=None):
    value = value if isinstance(value, dict) else {}
    avatar = next((a for a in CATALOG if a["id"] == value.get("avatarId")), CATALOG[0])
    styles = value.get("styles")
    raw = styles.get(avatar["id"], {}) if isinstance(styles, dict) else {}
    raw = raw if isinstance(raw, dict) else {}
    style = {k: raw[k].upper() if isinstance(raw.get(k), str) and re.fullmatch(r"#[0-9a-fA-F]{6}", raw[k]) else avatar[k] for k in ("color", "accent")}
    style["accessory"] = raw.get("accessory") if raw.get("accessory") in ("none", "scarf", "bow", "sparkle") else "none"
    style["markings"] = raw.get("markings") if raw.get("markings") in ("plain", "cheeks", "freckles") else "plain" if avatar.get("minimal") else "cheeks"
    return avatar, style


def body_svg(avatar, style) -> bytes:
    colour, accent = style["color"], style["accent"]
    parts = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="-120 -115 240 230">',
             f'<defs><radialGradient id="body" cx="36%" cy="32%" r="80%"><stop stop-color="{shade(colour, .38)}"/><stop offset=".55" stop-color="{colour}"/><stop offset="1" stop-color="{shade(colour, -.26)}"/></radialGradient></defs>',
             f'<path d="{escape(avatar["body"])}" fill="url(#body)" stroke="#ffffff" stroke-opacity=".2" stroke-width="1"/>']
    for detail in avatar["details"]:
        line = detail["tone"] == "line"
        parts.append(f'<path d="{escape(detail["path"])}" fill="{"none" if line else accent}" stroke="{shade(accent, -.18) if line else "none"}" stroke-width="3" stroke-linecap="round"/>')
    if not avatar.get("minimal") and avatar.get("face"):
        parts.append(f'<path d="{escape(avatar["face"])}" fill="{shade(colour, .76)}"/>')
    if style["markings"] == "cheeks":
        parts += [f'<ellipse cx="{side * 46}" cy="27" rx="12" ry="5.5" fill="#cf6887" fill-opacity=".35"/>' for side in (-1, 1)]
    elif style["markings"] == "freckles":
        parts += [f'<circle cx="{side * (33 + i * 8.25)}" cy="{28 - i % 2 * 7}" r="2.1" fill="{shade(accent, -.1)}"/>' for side in (-1, 1) for i in range(3)]
    for detail in ACCESSORIES.get(style["accessory"], []):
        line = detail["tone"] == "line"
        fill = "none" if line else shade(accent, .4) if detail["tone"] == "light" else accent
        parts.append(f'<path d="{escape(detail["path"])}" fill="{fill}" stroke="{"#ffffff" if line else "none"}" stroke-opacity=".3" stroke-width="1.5"/>')
    parts.append('</svg>')
    return ''.join(parts).encode('utf-8')


class HoloAvatar:
    """Retains the HUD's animation interface; the old human mesh is retired."""
    SPAN = 2.2

    def __init__(self):
        self._time = 0.0
        self._next_read = 0.0
        self._signature = None
        self._look = (0.0, 0.0)
        self._look_until = 0.0
        self._mouth = 0.0
        self._state = "IDLE"
        self._speaking = False
        self.avatar, self.style = appearance()
        self._svg = QSvgRenderer(QByteArray(body_svg(self.avatar, self.style)))
        self._load_preferences()

    def _load_preferences(self):
        try:
            config = json.loads((data_root() / "config" / "api_keys.json").read_text(encoding="utf-8"))
            avatar, style = appearance(config.get("companion"))
        except (OSError, ValueError, TypeError):
            return  # Keep the previous portrait during an atomic settings update.
        signature = json.dumps([avatar["id"], style], sort_keys=True)
        if signature != self._signature:
            self.avatar, self.style = avatar, style
            self._svg = QSvgRenderer(QByteArray(body_svg(avatar, style)))
            self._signature = signature
            if QApplication.instance():
                pixmap = QPixmap(128, 128); pixmap.fill(Qt.GlobalColor.transparent)
                painter = QPainter(pixmap)
                self.paint(painter, 64, 64, 52, None, None, None)
                painter.end()
                icon = QIcon(pixmap)
                QApplication.setWindowIcon(icon)
                for window in QApplication.topLevelWidgets():
                    window.setWindowIcon(icon)

    def glance(self, dx: float, dy: float, hold: float = 1.1):
        self._look = (max(-1, min(1, dx)), max(-1, min(1, dy)))
        self._look_until = self._time + max(0, hold)

    def clear_speech(self):
        self._mouth = 0.0
        self._speaking = False

    def step(self, dt, amp, speaking=False, muted=False, state="IDLE", v_open=None, **_):
        self._time += max(0, min(float(dt), .1))
        self._state, self._speaking = str(state).upper(), speaking
        target = max(0, min(1, float(v_open if v_open is not None else amp * 3))) if speaking and not muted else 0
        self._mouth += (target - self._mouth) * (1 - math.exp(-max(0, dt) / .035))
        if self._time >= self._next_read:
            self._next_read = self._time + 1
            self._load_preferences()

    def paint(self, p: QPainter, cx, cy, radius, primary, accent, bg):
        p.save(); p.setRenderHint(QPainter.RenderHint.Antialiasing)
        p.translate(cx, cy + math.sin(self._time * 2) * radius * .015)
        p.rotate(math.sin(self._time * .9) * 1.3)
        self._svg.render(p, QRectF(-radius * 1.2, -radius * 1.15, radius * 2.4, radius * 2.3))
        look = self._look if self._time < self._look_until else (math.sin(self._time * .45) * .2, 0)
        blink = .12 if self._time % 4.3 > 4.16 else 1
        sleeping = self._state in ("SLEEPING", "SLEEP")
        rgb = [int(self.style["color"][i:i+2], 16) / 255 for i in (1, 3, 5)]
        lum = sum((v / 12.92 if v <= .04045 else ((v + .055) / 1.055) ** 2.4) * w for v, w in zip(rgb, (.2126, .7152, .0722)))
        ink = "#f7f3ff" if self.avatar.get("minimal") and lum < .24 else "#242632"
        p.setPen(Qt.PenStyle.NoPen); p.setBrush(QColor(ink))
        for side in (-1, 1):
            p.drawEllipse(QPointF((side * .34 + look[0] * .13) * radius, (.04 + look[1] * .1) * radius), radius * .064, radius * (.018 if sleeping else .13 * blink))
        if self._mouth > .015:
            p.drawEllipse(QPointF(0, radius * .32), radius * (.07 + self._mouth * .05), radius * (.015 + self._mouth * .12))
        else:
            p.setBrush(Qt.BrushStyle.NoBrush); p.setPen(QPen(QColor(ink), radius * .022))
            p.drawArc(QRectF(-radius * .07, radius * .2, radius * .14, radius * .12), 190 * 16, 160 * 16)
        if self._state in ("THINKING", "PROCESSING", "SEARCHING"):
            p.setPen(Qt.PenStyle.NoPen); p.setBrush(QColor("#8872c5"))
            p.drawRoundedRect(QRectF(-radius * .91, -radius * .99, radius * .6, radius * .28), radius * .14, radius * .14)
            for i in range(3):
                p.setBrush(QColor("#ffffff")); r = radius * (.035 + .009 * math.sin(self._time * 5 - i * 1.3))
                p.drawEllipse(QPointF(radius * (-.77 + i * .16), -radius * .85), r, r)
        p.restore()
