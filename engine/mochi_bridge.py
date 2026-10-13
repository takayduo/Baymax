"""
mochi_bridge.py — High-Performance Python Bridge for Mochi Ultra
Connects Mochi's Electron main process with Mark-LV's Autonomous PC Control Engine,
Action Registry, Audio Hardware, and Long-Term Memory.
"""

from __future__ import annotations

import sys
import os
import json
import traceback
from pathlib import Path

# Force UTF-8 on Windows
for stream in (sys.stdout, sys.stderr):
    if hasattr(stream, "reconfigure"):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass

from core.paths import resource_root
BASE_DIR = resource_root()
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

from core.action_loader import discover_actions
from core.entitlements import authorize, filter_tools
from memory import config_manager
from memory.memory_manager import (
    load_memory, all_entries_for_ui, remember, forget, update_memory
)

# Global Action Registry instance
ACTIONS_DIR = BASE_DIR / "actions"
_registry = None


def get_registry():
    global _registry
    if _registry is None:
        _registry = discover_actions(actions_dir=ACTIONS_DIR, logger=lambda m: None)
    return _registry


def cmd_list_actions():
    reg = get_registry()
    decls = filter_tools(reg.get_tool_declarations())
    return {"success": True, "actions": decls, "count": len(decls)}


def cmd_list_devices():
    try:
        import io
        from contextlib import redirect_stdout
        f = io.StringIO()
        with redirect_stdout(f):
            from core.audio_devices import list_devices
            inputs = list_devices("input")
            outputs = list_devices("output")
        # Echo debug info to stderr
        sys.stderr.write(f.getvalue())
        return {"success": True, "inputs": inputs, "outputs": outputs}
    except Exception as e:
        return {"success": False, "error": str(e), "inputs": [], "outputs": []}


def cmd_list_memory():
    try:
        entries = all_entries_for_ui()
        raw = load_memory()
        return {"success": True, "entries": entries, "raw": raw}
    except Exception as e:
        return {"success": False, "error": str(e), "entries": []}


def cmd_save_memory(category: str, key: str, value: str):
    try:
        res = remember(key=key, value=value, category=category or "notes")
        return {"success": True, "result": res}
    except Exception as e:
        return {"success": False, "error": str(e)}


def cmd_delete_memory(category: str, key: str):
    try:
        res = forget(key=key, category=category or "notes")
        return {"success": True, "result": res}
    except Exception as e:
        return {"success": False, "error": str(e)}


def cmd_execute_action(name: str, parameters: dict):
    reg = get_registry()
    if not reg.has(name):
        return {"success": False, "error": f"Action '{name}' is not registered."}
    try:
        authorize(name, parameters)
        return reg.run_result(name, parameters or {})
    except Exception as e:
        return {"success": False, "error": f"Execution error: {e}", "traceback": traceback.format_exc()}


def cmd_sync_config(cfg: dict):
    try:
        config_manager.ensure_config_dir()
        existing = config_manager.load_api_keys()

        # Update fields if provided
        if "geminiApiKey" in cfg and cfg["geminiApiKey"]:
            existing["gemini_api_key"] = cfg["geminiApiKey"].strip()
        if "assistantName" in cfg:
            existing["assistant_name"] = cfg["assistantName"].strip() or "Mochi"
        user_role = str(cfg.get("userRole") or existing.get("user_role") or "me").strip().lower()
        existing["user_role"] = user_role
        if user_role == "her":
            existing["user_name"] = (cfg.get("partnerName") or cfg.get("userName") or existing.get("partner_name") or existing.get("user_name") or "Ayzil").strip()
            existing["partner_name"] = (cfg.get("userName") or existing.get("userName") or "Badsha").strip()
        else:
            existing["user_name"] = (cfg.get("userName") or existing.get("user_name") or "Badsha").strip()
            existing["partner_name"] = (cfg.get("partnerName") or existing.get("partner_name") or "Ayzil").strip()
        if "voiceName" in cfg:
            existing["voice_name"] = cfg["voiceName"].strip()
        if "wakeWordEnabled" in cfg:
            existing["wake_word_enabled"] = bool(cfg["wakeWordEnabled"])
        if "pushToTalkEnabled" in cfg:
            existing["push_to_talk_enabled"] = bool(cfg["pushToTalkEnabled"])
        if "pushToTalkKey" in cfg:
            existing["push_to_talk_key"] = str(cfg["pushToTalkKey"])
        if "proactiveAudio" in cfg:
            existing["proactive_audio"] = bool(cfg["proactiveAudio"])
        if "thinkingEnabled" in cfg:
            existing["thinking_enabled"] = bool(cfg["thinkingEnabled"])
        if "morningBriefEnabled" in cfg:
            existing["morning_brief_enabled"] = bool(cfg["morningBriefEnabled"])
        if "mediaResolution" in cfg:
            existing["media_resolution"] = cfg["mediaResolution"].strip()
        if "hudStyle" in cfg:
            existing["hud_style"] = cfg["hudStyle"].strip()
        if "audioInputDevice" in cfg:
            existing["input_device"] = cfg["audioInputDevice"].strip()
        if "audioOutputDevice" in cfg:
            existing["output_device"] = cfg["audioOutputDevice"].strip()

        # Turn tuning
        turn_tuning = existing.get("turn_tuning", {})
        if not isinstance(turn_tuning, dict):
            turn_tuning = {}
        if "turnSilenceMs" in cfg:
            turn_tuning["silence_ms"] = int(cfg["turnSilenceMs"])
        if "turnPrefixMs" in cfg:
            turn_tuning["prefix_ms"] = int(cfg["turnPrefixMs"])
        if "turnEndSensitivity" in cfg:
            turn_tuning["end_sensitivity"] = str(cfg["turnEndSensitivity"])
        existing["turn_tuning"] = turn_tuning

        # Action / Plugin enables
        if "activeActions" in cfg and isinstance(cfg["activeActions"], dict):
            existing["plugins_enabled"] = cfg["activeActions"]

        config_manager.CONFIG_FILE.write_text(
            json.dumps(existing, indent=4),
            encoding="utf-8"
        )
        return {"success": True, "saved": existing}
    except Exception as e:
        return {"success": False, "error": str(e)}


def handle_request(req: dict) -> dict:
    cmd = req.get("cmd") or req.get("action")
    if cmd == "list-actions":
        return cmd_list_actions()
    elif cmd == "list-devices":
        return cmd_list_devices()
    elif cmd == "list-memory":
        return cmd_list_memory()
    elif cmd == "save-memory":
        return cmd_save_memory(req.get("category", "notes"), req.get("key", ""), req.get("value", ""))
    elif cmd == "delete-memory":
        return cmd_delete_memory(req.get("category", "notes"), req.get("key", ""))
    elif cmd == "execute":
        return cmd_execute_action(req.get("name", ""), req.get("parameters", {}))
    elif cmd == "sync-config":
        return cmd_sync_config(req.get("config", {}))
    else:
        return {"success": False, "error": f"Unknown command: {cmd}"}


def run_server():
    """Persistent stdio line-based server for instant zero-latency tool calls."""
    # Warm up action registry
    get_registry()
    sys.stdout.write(json.dumps({"status": "ready"}) + "\n")
    sys.stdout.flush()

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
            req_id = req.get("id")
            res = handle_request(req)
            if req_id is not None:
                res["id"] = req_id
            sys.stdout.write(json.dumps(res) + "\n")
            sys.stdout.flush()
        except Exception as e:
            err_res = {"success": False, "error": str(e), "traceback": traceback.format_exc()}
            sys.stdout.write(json.dumps(err_res) + "\n")
            sys.stdout.flush()


def main():
    if len(sys.argv) > 1:
        first = sys.argv[1].lower()
        if first == "server":
            run_server()
            return
        elif first == "list-actions":
            print(json.dumps(cmd_list_actions()))
            return
        elif first == "list-devices":
            print(json.dumps(cmd_list_devices()))
            return
        elif first == "list-memory":
            print(json.dumps(cmd_list_memory()))
            return
        elif first == "save-memory":
            cat = sys.argv[2] if len(sys.argv) > 2 else "notes"
            k = sys.argv[3] if len(sys.argv) > 3 else ""
            v = sys.argv[4] if len(sys.argv) > 4 else ""
            print(json.dumps(cmd_save_memory(cat, k, v)))
            return
        elif first == "delete-memory":
            cat = sys.argv[2] if len(sys.argv) > 2 else "notes"
            k = sys.argv[3] if len(sys.argv) > 3 else ""
            print(json.dumps(cmd_delete_memory(cat, k)))
            return
        elif first in ("execute", "execute-action"):
            # mochi_bridge.py execute <name> '<json_params>'
            name = sys.argv[2] if len(sys.argv) > 2 else ""
            params_raw = sys.argv[3] if len(sys.argv) > 3 else "{}"
            try:
                params = json.loads(params_raw)
            except Exception:
                try:
                    import re
                    fixed = re.sub(r'([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)\s*:', r'\1"\2":', params_raw)
                    fixed = re.sub(r':\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*([,}])', r': "\1"\2', fixed)
                    params = json.loads(fixed)
                except Exception:
                    params = {}
            print(json.dumps(cmd_execute_action(name, params)))
            return
        elif first == "sync-config":
            # mochi_bridge.py sync-config '<json_config>'
            cfg_raw = sys.argv[2] if len(sys.argv) > 2 else "{}"
            try:
                cfg = json.loads(cfg_raw)
            except Exception:
                cfg = {}
            print(json.dumps(cmd_sync_config(cfg)))
            return

    # If called without recognized args, run server mode
    run_server()


if __name__ == "__main__":
    main()
