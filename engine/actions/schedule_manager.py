from core.electron_rpc import request

def manage_schedule(parameters=None, player=None, **kwargs):
    return request("manage_schedule", parameters or {})

TOOL = {
    "name": "manage_schedule",
    "description": (
        "Manages the shared daily creator couple schedule and tasks for both users. "
        "Supports adding tasks for 'me', 'her', or 'both', marking tasks completed, "
        "and listing today's schedule. Use when the user says: "
        "'add a task for her/me/both', 'schedule review for 3 PM', 'what are my tasks', "
        "'what does she have to do', 'mark thumbnail as done', etc."
    ),
    "parameters": {
        "type": "OBJECT",
        "properties": {
            "action": {
                "type": "STRING",
                "description": "'add' to create a task, 'complete' to mark done, 'list' to view tasks. Default: 'list'",
            },
            "title": {
                "type": "STRING",
                "description": "The task title / description",
            },
            "time_str": {
                "type": "STRING",
                "description": "Optional scheduled time (e.g. '11:00 AM', '03:30 PM', 'today')",
            },
            "for_who": {
                "type": "STRING",
                "description": "Who the task is for: 'me', 'her', or 'both'. Default: 'me'",
            },
        },
        "required": [
            "action"
        ],
    },
    "handler": manage_schedule,
}
