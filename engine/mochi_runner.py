"""
mochi_runner.py — Native Mark-LV Headless Assistant Runner for Mochi Ultra
Connects Mochi Ultra directly to the real-time Gemini Live WebSocket API,
hardware audio streaming via sounddevice, 17 autonomous PC control actions,
and memory. Communicates with Electron over stdin/stdout.
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
import threading
import time
from pathlib import Path

# Force UTF-8 encoding on Windows standard streams
for stream in (sys.stdout, sys.stderr, sys.stdin):
    if hasattr(stream, "reconfigure"):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass

BASE_DIR = Path(__file__).resolve().parent
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

# Import the authentic Mark-LV live assistant
from main import JarvisLive, BASE_DIR, API_CONFIG_PATH
from memory import config_manager


def emit_ipc(event_type: str, data: dict = None):
    """Write structured IPC message to Electron stdout."""
    payload = {"event": event_type}
    if data:
        payload.update(data)
    try:
        sys.stdout.write("MOCHI_IPC:" + json.dumps(payload, ensure_ascii=False) + "\n")
        sys.stdout.flush()
    except Exception as e:
        sys.stderr.write(f"[mochi_runner] IPC emit error: {e}\n")


class _WinShim:
    """Shim for JarvisUI._win."""
    def __init__(self):
        self._ready = True


class _RootShim:
    """Shim for JarvisUI.root."""
    def mainloop(self):
        pass

    def protocol(self, *_):
        pass


class MochiHeadlessUI:
    """
    Headless presenter that duck-types JarvisUI.
    Receives all live state, audio levels, visemes, and transcripts from JarvisLive
    and forwards them to Mochi Ultra's Electron interface in real time.
    """

    def __init__(self):
        self._win = _WinShim()
        self.root = _RootShim()
        self._muted = False
        self._current_file: str | None = None
        self._last_audio_level_ts = 0.0

        # Callbacks set by JarvisLive.__init__
        self.on_push_to_talk = None
        self.ptt_hold = None
        self.on_text_command = None
        self.on_remote_clicked = None
        self.on_interrupt = None
        self.on_voice_change = None
        self.on_audio_device_change = None
        self.get_plugins = None
        self.get_plugin_settings = None
        self.request_say = None
        self.wake_is_ready = None
        self.wake_get_state = None
        self.on_wake_toggle = None
        self.on_wake_manual = None
        self.on_wake_install = None

    @property
    def muted(self) -> bool:
        return self._muted

    @muted.setter
    def muted(self, value: bool):
        self._muted = bool(value)
        emit_ipc("muted", {"muted": self._muted})

    @property
    def current_file(self) -> str | None:
        return self._current_file

    @current_file.setter
    def current_file(self, value: str | None):
        self._current_file = value

    def emit(self, event: str, data: dict = None):
        """Emit arbitrary IPC event to Electron."""
        emit_ipc(event, data or {})

    def set_state(self, state: str):
        """Called by JarvisLive when assistant state changes (LISTENING, THINKING, SPEAKING, SLEEPING)."""
        emit_ipc("state", {"state": state})

    def write_log(self, text: str):
        """Called by JarvisLive for transcripts and system status."""
        text = str(text).strip()
        if not text:
            return

        # Parse speaker vs system
        if text.startswith("You:"):
            msg = text[4:].strip()
            emit_ipc("transcript", {"role": "user", "text": msg})
        elif ":" in text and not text.startswith("SYS:") and not text.startswith("ERR:") and not text.startswith("NET:"):
            parts = text.split(":", 1)
            role = parts[0].strip().lower()
            msg = parts[1].strip()
            emit_ipc("transcript", {"role": "assistant", "speaker": role, "text": msg})
        else:
            emit_ipc("log", {"text": text})

    def set_audio_level(self, level: float):
        """Called from audio loop with 0.0-1.0 RMS level. Throttled to ~20Hz to keep IPC light."""
        now = time.monotonic()
        if now - self._last_audio_level_ts >= 0.05:
            self._last_audio_level_ts = now
            emit_ipc("audio_level", {"level": round(float(level), 3)})

    def push_visemes(self, frames, hop: float, at: float):
        """Mouth shape schedule for avatar visualization."""
        if frames:
            emit_ipc("visemes", {"frames": frames, "hop": hop, "at": at})

    def glance(self, dx: float, dy: float, hold: float = 1.1):
        pass

    def show_confirm(self, title: str, detail: str):
        emit_ipc("confirm", {"title": title, "detail": detail})

    def hide_confirm(self):
        emit_ipc("hide_confirm")

    def show_content(self, title: str, text: str):
        emit_ipc("content", {"title": title, "text": text})

    def emit_productivity_command(self, action: str, duration_minutes: int = 60, mode: str = "Deep Silence"):
        emit_ipc("focus_session_command", {"action": action, "duration_minutes": duration_minutes, "mode": mode})

    def show_quiz(self, topic: str, questions, grade=None):
        emit_ipc("quiz", {"topic": topic, "questions": questions})

    def hide_quiz(self):
        emit_ipc("hide_quiz")

    def show_review(self, title: str, summary: str, findings, unclear=None):
        emit_ipc("review", {
            "title": title,
            "summary": summary,
            "findings": findings,
            "unclear": unclear or []
        })

    def prompt_reconfig(self):
        emit_ipc("reconfig")

    def show_camera_frame(self, img_bytes: bytes):
        pass

    def show_video(self, source: str, title: str = "", muted: bool = True, audio_source: str = ""):
        if source and (source.startswith("http://") or source.startswith("https://")):
            try:
                import webbrowser
                webbrowser.open(source)
            except Exception as e:
                sys.stderr.write(f"[mochi_runner] show_video open error: {e}\n")
        emit_ipc("video", {"source": source, "title": title, "muted": muted, "audio_source": audio_source})

    def start_camera_stream(self):
        emit_ipc("camera_stream_start")

    def stop_camera_stream(self):
        emit_ipc("camera_stream_stop")

    def notify_phone_connected(self):
        emit_ipc("phone_connected")

    def wait_for_api_key(self):
        while not self._win._ready:
            time.sleep(0.1)


def stdin_reader_thread(ui: MochiHeadlessUI, jarvis: JarvisLive):
    """Listens on sys.stdin for commands sent from Electron."""
    sys.stderr.write("[mochi_runner] stdin reader thread started\n")
    sys.stderr.flush()

    while True:
        try:
            line = sys.stdin.readline()
            if not line:
                break
            line = line.strip()
            if not line:
                continue

            try:
                cmd_data = json.loads(line)
            except Exception:
                continue

            cmd = cmd_data.get("cmd")

            if cmd == "text":
                text = cmd_data.get("text", "")
                if text and ui.on_text_command:
                    ui.on_text_command(text)

            elif cmd == "interrupt":
                if ui.on_interrupt:
                    ui.on_interrupt()

            elif cmd == "mute":
                muted = cmd_data.get("muted", True)
                ui.muted = muted

            elif cmd == "voice":
                voice = cmd_data.get("voice")
                if voice and ui.on_voice_change:
                    ui.on_voice_change(voice)

            elif cmd == "audio_device":
                kind = cmd_data.get("kind", "input")
                device_name = cmd_data.get("name", "")
                if ui.on_audio_device_change:
                    ui.on_audio_device_change(kind, device_name)

            elif cmd == "wake_toggle":
                enabled = cmd_data.get("enabled", False)
                if ui.on_wake_toggle:
                    ui.on_wake_toggle(enabled)

            elif cmd == "ptt":
                held = cmd_data.get("held", False)
                if ui.ptt_hold:
                    ui.ptt_hold(held)

            elif cmd == "ping":
                emit_ipc("pong", {"ts": time.time()})

        except Exception as e:
            sys.stderr.write(f"[mochi_runner] stdin error: {e}\n")
            sys.stderr.flush()


def run_mochi_ultra():
    """Initializes and runs JarvisLive with MochiHeadlessUI."""
    emit_ipc("starting")
    ui = MochiHeadlessUI()
    jarvis = JarvisLive(ui)

    # Start the stdin command loop in background thread
    t = threading.Thread(target=stdin_reader_thread, args=(ui, jarvis), daemon=True)
    t.start()

    emit_ipc("ready")
    print("[Mochi Ultra] Live Assistant Engine Initialized")

    try:
        asyncio.run(jarvis.run())
    except KeyboardInterrupt:
        print("[Mochi Ultra] Assistant stopped cleanly.")
    except Exception as e:
        sys.stderr.write(f"[Mochi Ultra] Fatal error: {e}\n")
        emit_ipc("fatal_error", {"error": str(e)})


if __name__ == "__main__":
    run_mochi_ultra()
