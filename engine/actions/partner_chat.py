from core.electron_rpc import request

def send_partner_message(parameters=None, player=None, **kwargs):
    return request("send_partner_message", parameters or {})

TOOL = {
    "name": "send_partner_message",
    "description": (
        "Sends a direct live chat message to the creator partner (e.g. Ayzil, Her, Badsha) "
        "via Mochi's live couple channel. Use this whenever the user says: "
        "'send a message to her', 'text her', 'tell her...', 'message my partner', etc. "
        "Write 'message_text' in the user's natural language and exact intent."
    ),
    "parameters": {
        "type": "OBJECT",
        "properties": {
            "message_text": {
                "type": "STRING",
                "description": "The message text to send to the partner",
            }
        },
        "required": [
            "message_text"
        ],
    },
    "handler": send_partner_message,
}
