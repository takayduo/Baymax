"""Read-only bundled resources and writable per-user engine data."""
import os
import sys
from pathlib import Path


def resource_root() -> Path:
    if getattr(sys, "frozen", False):
        return Path(sys._MEIPASS)
    return Path(__file__).resolve().parent.parent


def data_root() -> Path:
    if os.environ.get("BAYMAX_ENGINE_DATA"):
        return Path(os.environ["BAYMAX_ENGINE_DATA"]).resolve()
    if getattr(sys, "frozen", False):
        return Path(os.environ.get("LOCALAPPDATA", str(Path.home()))) / "Baymax" / "engine"
    return resource_root()


def python_command() -> list[str]:
    """A frozen executable needs an explicit script-runner mode."""
    return [sys.executable, "python"] if getattr(sys, "frozen", False) else [sys.executable]
