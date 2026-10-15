"""Control Baymax itself through the authenticated local Electron RPC."""
from core.electron_rpc import request

def control_app(parameters=None, player=None, **kwargs):
    return request('control_app', parameters or {})

TOOL = {
    'name': 'control_app',
    'description': 'Control Baymax built-in music, shared partner playlist, Listen Together, app navigation and emotes. Default to this player when the user requests music without naming another app. If they explicitly name Spotify, YouTube or another app, use the corresponding browser/PC tools instead. Use music play with query to find a song, play without query to resume; add_shared adds query or current song; join listens with the online partner. Only report success after the tool succeeds.',
    'parameters': {'type':'OBJECT','properties': {
        'action': {'type':'STRING','enum':['music','open_view','emote','read_partner_messages']},
        'command': {'type':'STRING','enum':['play','resume','pause','next','previous','volume','add_shared','join','leave']},
        'query': {'type':'STRING','description':'Song/artist search, optional for play or add_shared'},
        'volume': {'type':'NUMBER','description':'Music volume 0 to 100'},
        'view': {'type':'STRING','enum':['music','chat','partner_chat','tasks','share','productivity','settings']},
        'emote': {'type':'STRING','enum':['love','celebrate','vibe','dizzy','sleepy']},
    },'required':['action']},
    'handler':control_app,
}
