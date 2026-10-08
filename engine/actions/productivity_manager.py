"""
productivity_manager.py — Screen Time Analytics, App Classification, and Focus Session Engine for Baymax
Provides autonomous access for Baymax AI to:
1. Track & analyze daily screen time, focus score %, and app usage breakdown.
2. Start and stop focus sessions for any duration (e.g. 1 hour, 45 minutes).
3. Automatically blacklist and block distraction-marked apps during focus sessions.
4. Classify applications as productive, neutral, or wasteful (distraction).
"""

from __future__ import annotations

import json
import math
import os
import time
from datetime import datetime
from pathlib import Path


def _get_distrack_data_path() -> Path:
    appdata = os.environ.get("APPDATA", "")
    candidates = [
        Path(appdata) / "mochi-ultra" / "distrack-data.json",
        Path(appdata) / "baymax" / "distrack-data.json",
        Path(appdata) / "distrack" / "distrack-data.json",
        Path(appdata) / "Mochi-Ultra" / "distrack-data.json",
    ]
    for c in candidates:
        if c.exists():
            return c
    # Default to mochi-ultra directory
    default_p = Path(appdata) / "mochi-ultra" / "distrack-data.json"
    default_p.parent.mkdir(parents=True, exist_ok=True)
    return default_p


def _load_data() -> dict:
    p = _get_distrack_data_path()
    if p.exists():
        try:
            with open(p, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            print("[Productivity] Error loading distrack-data.json:", e)
    return {
        "usageData": {},
        "appCategories": {},
        "focusSessions": [],
        "blocklist": [],
        "settings": {"theme": "dark", "notifications": True},
        "userProfile": {"name": "Badsha", "email": "user@baymax.local"},
    }


def _save_data(data: dict) -> bool:
    p = _get_distrack_data_path()
    try:
        tmp = p.with_suffix(".tmp")
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        tmp.replace(p)
        return True
    except Exception as e:
        print("[Productivity] Error saving distrack-data.json:", e)
        return False


def _get_user_name() -> str:
    appdata = os.environ.get("APPDATA", "")
    for parent in ("mochi-ultra", "baymax", "Mochi-Ultra"):
        cfg_p = Path(appdata) / parent / "CoucouCreator" / "settings.json"
        if cfg_p.exists():
            try:
                with open(cfg_p, "r", encoding="utf-8") as f:
                    s = json.load(f)
                    role = s.get("userRole", "me")
                    if role == "her":
                        return s.get("partnerName") or s.get("userName") or "Ayzil"
                    return s.get("userName") or "Badsha"
            except Exception:
                pass
    return "Badsha"


def _format_duration(seconds: int) -> str:
    if seconds <= 0:
        return "0 minutes"
    hours = seconds // 3600
    minutes = (seconds % 3600) // 60
    if hours > 0 and minutes > 0:
        return f"{hours}h {minutes}m"
    elif hours > 0:
        return f"{hours}h"
    else:
        return f"{max(1, minutes)}m"


def manage_productivity(parameters=None, player=None, **kwargs) -> str:
    """
    Core handler for productivity, screen time analysis, and focus sessions.
    """
    params = parameters or {}
    action = (params.get("action") or "analyze_stats").strip().lower()
    duration_min = int(params.get("duration_minutes") or params.get("minutes") or 60)
    mode = params.get("mode") or "Deep Silence"
    app_name = (params.get("app_name") or params.get("app") or "").strip().lower()
    category = (params.get("category") or "").strip().lower()

    data = _load_data()
    today_key = datetime.now().strftime("%Y-%m-%d")
    today_usage = data.get("usageData", {}).get(today_key, {})
    categories = data.get("appCategories", {})
    blocklist = data.get("blocklist", [])
    user_name = _get_user_name()

    # ──────────────────────────────────────────────────────────────────────────
    # 1. START FOCUS SESSION
    # ──────────────────────────────────────────────────────────────────────────
    if action in ("start_focus", "start_session", "focus", "start"):
        # Auto-blacklist all apps categorized as 'wasteful'
        wasteful_apps = [name for name, cat in categories.items() if cat == "wasteful"]
        # Default distraction culprits if none explicitly marked yet
        common_distractions = ["discord", "telegram", "whatsapp", "steam", "valorant", "leagueclient", "robloxplayerbeta"]
        for d in common_distractions:
            if d not in categories:
                categories[d] = "wasteful"
            if d not in wasteful_apps:
                wasteful_apps.append(d)

        # Merge wasteful apps into blocklist
        new_blocklist = list(set(blocklist + wasteful_apps))
        data["blocklist"] = new_blocklist
        data["appCategories"] = categories

        session_id = str(int(time.time() * 1000))
        new_session = {
            "id": session_id,
            "startTime": datetime.now().isoformat(),
            "durationMinutes": duration_min,
            "mode": mode,
            "completed": False,
        }
        sessions = data.get("focusSessions", [])
        sessions.insert(0, new_session)
        data["focusSessions"] = sessions[:100]
        _save_data(data)

        # Signal Electron blocker to immediately begin enforcing
        if player and hasattr(player, "emit_productivity_command"):
            player.emit_productivity_command(action="start", duration_minutes=duration_min, mode=mode)
        elif player and hasattr(player, "emit_ipc"):
            player.emit_ipc("focus_session_command", {"action": "start", "duration_minutes": duration_min, "mode": mode})

        sample_apps = ", ".join(wasteful_apps[:4]) if wasteful_apps else "all distractions"
        spoken_msg = (
            f"Focus session started for {duration_min} minutes in {mode} mode. "
            f"All {len(wasteful_apps)} distraction apps ({sample_apps}) are now automatically blacklisted "
            f"and will be blocked if opened. Let's stay focused on your work, {user_name}!"
        )

        card_text = (
            f"🎯 Mode: {mode}\n"
            f"⏱️ Duration: {duration_min} minutes\n"
            f"🛡️ Blacklisted Apps: {len(wasteful_apps)} ({sample_apps})\n"
            f"⚡ Active Protection: Distraction processes will be intercepted and closed automatically."
        )
        if player and hasattr(player, "show_content"):
            player.show_content(f"FOCUS SESSION — {duration_min} MIN", card_text)

        return spoken_msg

    # ──────────────────────────────────────────────────────────────────────────
    # 2. STOP FOCUS SESSION
    # ──────────────────────────────────────────────────────────────────────────
    elif action in ("stop_focus", "stop_session", "stop", "end_focus", "cancel_focus"):
        sessions = data.get("focusSessions", [])
        if sessions and not sessions[0].get("completed"):
            sessions[0]["completed"] = True
            sessions[0]["endedAt"] = datetime.now().isoformat()
            data["focusSessions"] = sessions
            _save_data(data)

        if player and hasattr(player, "emit_productivity_command"):
            player.emit_productivity_command(action="stop")
        elif player and hasattr(player, "emit_ipc"):
            player.emit_ipc("focus_session_command", {"action": "stop"})

        spoken_msg = f"Focus session stopped. Good effort, {user_name}! You can now access all applications freely."
        if player and hasattr(player, "show_content"):
            player.show_content("FOCUS SESSION ENDED", f"Session completed. Great work staying focused!")
        return spoken_msg

    # ──────────────────────────────────────────────────────────────────────────
    # 3. CLASSIFY APP CATEGORY
    # ──────────────────────────────────────────────────────────────────────────
    elif action in ("classify", "set_category", "mark_app"):
        if not app_name:
            return "Please specify the app name to categorize (e.g., discord, vs code, chrome)."
        if category not in ("productive", "neutral", "wasteful"):
            return "Category must be 'productive', 'neutral', or 'wasteful' (distraction)."

        categories[app_name] = category
        data["appCategories"] = categories

        # Also update today's usage category if present
        if app_name in today_usage:
            today_usage[app_name]["category"] = category
            data["usageData"][today_key] = today_usage

        _save_data(data)
        return f"Marked '{app_name}' as {category}."

    # ──────────────────────────────────────────────────────────────────────────
    # 4. ANALYZE SCREEN TIME & STATS (DEFAULT)
    # ──────────────────────────────────────────────────────────────────────────
    else:
        total_seconds = 0
        prod_seconds = 0
        waste_seconds = 0
        neutral_seconds = 0

        app_list = []
        for key, info in today_usage.items():
            secs = info.get("totalSeconds", 0)
            cat = categories.get(key, info.get("category", "neutral"))
            total_seconds += secs
            if cat == "productive":
                prod_seconds += secs
            elif cat == "wasteful":
                waste_seconds += secs
            else:
                neutral_seconds += secs
            app_list.append({
                "name": info.get("processName") or key,
                "seconds": secs,
                "category": cat,
            })

        app_list.sort(key=lambda x: x["seconds"], reverse=True)

        # Calculate Focus Score: productive / (productive + wasteful) * 100
        denom = prod_seconds + waste_seconds
        if denom > 0:
            focus_score = round((prod_seconds / denom) * 100)
        elif total_seconds > 0:
            focus_score = 75
        else:
            focus_score = 100

        total_str = _format_duration(total_seconds)
        prod_str = _format_duration(prod_seconds)
        waste_str = _format_duration(waste_seconds)

        top_apps = app_list[:3]
        top_apps_str = ", ".join([f"{a['name']} ({_format_duration(a['seconds'])})" for a in top_apps]) if top_apps else "no apps recorded yet today"

        if total_seconds == 0:
            msg = f"You haven't logged much screen time today yet, {user_name}. Ready to get productive whenever you are!"
        else:
            msg = (
                f"Today you have logged {total_str} of screen time with a {focus_score}% focus score. "
                f"You spent {prod_str} on productive work and {waste_str} on distractions. "
                f"Top apps: {top_apps_str}."
            )

        # Build visual card for Mochi island
        lines = [
            f"📊 Focus Score: {focus_score}%",
            f"⏱️ Total Screen Time: {total_str}",
            f"🚀 Productive: {prod_str}",
            f"⚠️ Distractions: {waste_str}",
            f"\nTop Active Apps:",
        ]
        for a in app_list[:5]:
            cat_icon = "🟢" if a["category"] == "productive" else ("🔴" if a["category"] == "wasteful" else "⚪")
            lines.append(f"  {cat_icon} {a['name']}: {_format_duration(a['seconds'])}")

        if player and hasattr(player, "show_content"):
            player.show_content(f"SCREEN TIME — {user_name} ({focus_score}%)", "\n".join(lines))

        return msg


# ── Tool declaration (auto-discovered by core/action_loader.py) ──────────────
TOOL = {
    "name": "productivity_manager",
    "description": (
        "Manages screen time tracking, distraction blocking, app categorization, and focus sessions. "
        "Allows Baymax to analyze the user's screen time, report focus scores, and start or stop focus "
        "sessions. When a focus session is started, distraction apps (like Discord, games, social media) "
        "are automatically blacklisted and blocked. Use when the user says: "
        "'start a focus session for 1 hour', 'analyze my screen time', 'how much time did I waste today', "
        "'stop the focus session', 'what are my most used apps', 'mark discord as distraction', etc."
    ),
    "parameters": {
        "type": "OBJECT",
        "properties": {
            "action": {
                "type": "STRING",
                "description": "'analyze_stats' to report screen time and focus score, 'start_focus' to begin a focus session, 'stop_focus' to end it, 'classify' to mark an app category.",
            },
            "duration_minutes": {
                "type": "INTEGER",
                "description": "Duration of focus session in minutes (e.g. 60 for 1 hour, 45, 25). Default: 60",
            },
            "mode": {
                "type": "STRING",
                "description": "Focus mode: 'Deep Silence' (strict blocklist + distractions), 'Light Focus' (wasteful apps only), or 'Strict Lock' (everything non-productive). Default: 'Deep Silence'",
            },
            "app_name": {
                "type": "STRING",
                "description": "App process name when classifying (e.g. 'discord', 'code', 'chrome').",
            },
            "category": {
                "type": "STRING",
                "description": "Category: 'productive', 'neutral', or 'wasteful'.",
            },
        },
        "required": [
            "action"
        ],
    },
    "handler": manage_productivity,
}
