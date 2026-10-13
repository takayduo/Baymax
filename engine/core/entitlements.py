"""Launch capabilities come from the desktop's verified account, never api_keys.json."""
import json
from core.electron_rpc import request

SAFE_ACTIONS = frozenset({
    'web_search', 'weather_report', 'flight_finder', 'reminder', 'manage_schedule',
    'productivity_manager', 'control_app', 'send_partner_message', 'screen_process',
    'close_camera', 'manage_monitor', 'shutdown_jarvis', 'save_memory', 'recall_memory',
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
    if name not in SAFE_ACTIONS:
        raise PermissionError('PC control is not included in this release')
    caps = capabilities() if caps is None else caps
    require('local', caps)
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
