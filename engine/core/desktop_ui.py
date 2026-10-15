"""Display and consent adapter for the persistent action worker (no microphone)."""
import json
import threading
from core.electron_rpc import request


class DesktopUI:
    current_file = None

    def write_log(self, text):
        print(str(text), flush=True)

    def show_confirm(self, title, detail):
        from core import confirm
        request_id = confirm.pending_id()
        def ask():
            try:
                accepted = json.loads(request('engine_confirm', {'title': title, 'detail': detail})) is True
            except Exception:
                accepted = False
            confirm.resolve(accepted, request_id)
        threading.Thread(target=ask, daemon=True, name='action-consent').start()

    def hide_confirm(self):
        pass

    def show_video(self, source, title='', muted=True, audio_source=''):
        return request('engine_video', {'command': 'play', 'source': source, 'title': title,
                                       'muted': muted, 'audioSource': audio_source})

    def video_is_playing(self):
        return json.loads(request('engine_video', {'command': 'status'})) is True

    def stop_video(self):
        return request('engine_video', {'command': 'stop'})

    def set_video_muted(self, muted):
        return request('engine_video', {'command': 'mute', 'muted': muted})


_ui = None
def action_ui():
    global _ui
    if _ui is None:
        from core import confirm
        _ui = DesktopUI()
        confirm.bind(_ui.show_confirm, _ui.hide_confirm, _ui.write_log)
    return _ui
