"""Compatibility identifiers only; new UI, files and tasks use Baymax names.

Do not remove these until installs with the old storage/task names are retired.
Existing data is copied without overwriting newer files or deleting the source.
"""
import shutil
from pathlib import Path

LEGACY_GAME_TASK = "JARVIS_GameUpdater"
LEGACY_GAME_LABEL = "com.jarvis.gameupdater"
LEGACY_AUTOSTART = "JARVIS_AI"
LEGACY_AUTOSTART_LABEL = "com.jarvis.assistant"
LEGACY_WAKE_MODEL = "hey_jarvis"


def copy_missing(source: Path, target: Path) -> Path:
    if source.is_symlink() or not source.exists():
        return target
    if source.is_dir():
        if target.exists() and not target.is_dir():
            return target
        target.mkdir(parents=True, exist_ok=True)
        for child in source.iterdir():
            copy_missing(child, target / child.name)
    elif not target.exists():
        target.parent.mkdir(parents=True, exist_ok=True)
        # Exclusive creation never overwrites a file created during migration.
        try:
            with source.open('rb') as incoming, target.open('xb') as outgoing:
                shutil.copyfileobj(incoming, outgoing)
        except FileExistsError:
            pass
    return target


def user_path(name: str) -> Path:
    aliases = {'.baymax': '.jarvis', '.baymax_profiles': '.jarvis_profiles',
               'Desktop/BaymaxProjects': 'Desktop/JarvisProjects'}
    target = Path.home() / name
    old = aliases.get(name)
    if old and not target.exists():
        copy_missing(Path.home() / old, target)
    return target


def certificate_path(folder: Path, suffix: str) -> Path:
    return copy_missing(folder / ('jarvis.' + suffix), folder / ('baymax.' + suffix))
