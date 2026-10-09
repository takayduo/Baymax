from core.electron_rpc import request

def close_app(parameters=None, player=None, **kwargs):
    return request("close_app", parameters or {})

TOOL = {
    "name": "close_app",
    "description": (
        "Closes, exits, terminates, or kills an application or game on the computer. "
        "Use this whenever the user asks to close, exit, quit, kill, or stop any app or game (e.g. 'close Valorant', 'exit Discord', 'close OBS', 'quit Premiere', 'close WhatsApp'). "
        "First checks configured Application Paths, then locates and terminates the app's process cleanly. "
        "Never use Alt+F4 directly."
    ),
    "parameters": {
        "type": "OBJECT",
        "properties": {
            "app_name": {
                "type": "STRING",
                "description": "Exact name or title of the application or game to close (e.g. 'Valorant', 'Discord', 'OBS', 'WhatsApp', 'Premiere', 'Notepad')",
            }
        },
        "required": ["app_name"],
    },
    "handler": close_app,
}
