from core.electron_rpc import request

def manage_productivity(parameters=None, player=None, **kwargs):
    return request("manage_productivity", parameters or {})

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
