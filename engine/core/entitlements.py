"""Launch capabilities come from the desktop's verified account, never api_keys.json."""
import json
from core.electron_rpc import request

PC_ACTIONS = frozenset({
    'computer_control', 'browser_control', 'desktop_control', 'computer_settings',
    'file_controller', 'file_processor', 'screen_processor', 'system_monitor',
    'code_helper', 'dev_agent', 'game_updater', 'video_player', 'youtube_video', 'send_message',
})

def capabilities():
    value = json.loads(request('entitlements', {}))
    if not isinstance(value, dict):
        raise RuntimeError('Account verification unavailable')
    return value

def require(feature, caps=None):
    caps = capabilities() if caps is None else caps
    if not caps.get(feature):
        raise PermissionError('Open Account & Plan to enable this feature')

def authorize(name, parameters=None, caps=None):
    caps = capabilities() if caps is None else caps
    require('local', caps)
    # The registry validates names. The desktop owns this live switch snapshot;
    # a running session must also respect switches changed after discovery.
    if caps.get('activeActions', {}).get(name) is False:
        raise PermissionError('This skill is disabled in Settings > AI engine')
    if name in PC_ACTIONS:
        require('pcControl', caps)
    parameters = parameters or {}
    if name == 'productivity_manager':
        require('productivity', caps)
    if name in ('screen_process', 'manage_monitor'):
        require('gemini', caps)
    if name == 'send_partner_message':
        require('partner', caps)
    if name == 'control_app':
        if parameters.get('view') == 'productivity':
            require('productivity', caps)
        if parameters.get('command') in ('join', 'add_shared'):
            require('listenTogether', caps)
        if parameters.get('action') == 'read_partner_messages':
            require('partner', caps)

def filter_tools(declarations):
    caps = capabilities()
    result = []
    for declaration in declarations:
        name = declaration.get('name') if isinstance(declaration, dict) else declaration.name
        try:
            authorize(name, caps=caps)
        except PermissionError:
            continue
        result.append(declaration)
    return result
