"""Validated commands to the Electron persistence owner, never direct file writes."""
import json
import os
import uuid
import urllib.request

def request(action, parameters):
    url, token = os.environ.get('BAYMAX_RPC_URL'), os.environ.get('BAYMAX_RPC_TOKEN')
    if not url or not token:
        raise RuntimeError('Open Baymax to use shared tasks, chat and productivity. No data was changed.')
    body = json.dumps({'id': str(uuid.uuid4()), 'action': action, 'parameters': parameters or {}}).encode('utf-8')
    req = urllib.request.Request(url, data=body, headers={'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'})
    # Ignore system proxy settings for the private loopback connection.
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with opener.open(req, timeout=30) as response:
        result = json.load(response)
    if not result.get('success'):
        raise RuntimeError(result.get('error') or 'Baymax could not complete the action')
    data = result.get('data')
    return data if isinstance(data, str) else json.dumps(data, ensure_ascii=False)
