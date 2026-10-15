"""Exercise production live-audio methods without opening a microphone or API session."""
import ast
import asyncio
from pathlib import Path
from types import SimpleNamespace
import unittest
import os
import sys
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'engine'))

source = Path(__file__).resolve().parents[1] / 'engine' / 'main.py'
tree = ast.parse(source.read_text(encoding='utf-8'))
live = next(n for n in tree.body if isinstance(n, ast.ClassDef) and n.name == 'BaymaxLive')
methods = [n for n in live.body if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) and n.name in ('_on_ptt', '_send_realtime', 'set_push_to_talk')]
scope = {'asyncio': asyncio, 'os': os, 'types': SimpleNamespace(Blob=lambda **values: values)}
exec(compile(ast.fix_missing_locations(ast.Module(body=methods, type_ignores=[])), str(source), 'exec'), scope)


class PushToTalkTests(unittest.IsolatedAsyncioTestCase):
    async def test_release_closes_audio_after_pcm_and_never_reopens_a_muted_mic(self):
        states, sent = [], []
        async def send(**message):
            sent.append(message)
        obj = SimpleNamespace(_ptt_enabled=True, _ptt_suspended=False, _ptt_held=False, _wake_enabled=False,
                              ui=SimpleNamespace(muted=False, set_state=states.append),
                              _loop=asyncio.get_running_loop(), out_queue=asyncio.Queue(),
                              session=SimpleNamespace(send_realtime_input=send))
        scope['_on_ptt'](obj, True)
        self.assertTrue(obj._ptt_held)
        obj.out_queue.put_nowait({'data': b'pcm', 'mime_type': 'audio/pcm'})
        scope['_on_ptt'](obj, False)
        scope['_on_ptt'](obj, False)  # Duplicate key-up cannot finish a second turn.
        await asyncio.sleep(0)
        task = asyncio.create_task(scope['_send_realtime'](obj))
        await asyncio.sleep(0)
        task.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await task
        self.assertEqual(sent, [{'audio': {'data': b'pcm', 'mime_type': 'audio/pcm'}}, {'audio_stream_end': True}])
        obj.ui.muted = True
        scope['_on_ptt'](obj, True)
        self.assertFalse(obj._ptt_held)

    async def test_live_config_off_reopens_listening_and_picker_suspension_blocks_a_hold(self):
        states = []
        obj = SimpleNamespace(_ptt_enabled=True, _ptt_held=False, _ptt_suspended=False, _ptt=None,
                              _wake_enabled=False, ui=SimpleNamespace(muted=False, set_state=states.append),
                              _loop=asyncio.get_running_loop(), out_queue=asyncio.Queue())
        obj._on_ptt=lambda held: scope['_on_ptt'](obj,held)
        with patch.dict(os.environ, {'BAYMAX_EXTERNAL_PTT':'1'}):
            self.assertEqual(scope['set_push_to_talk'](obj,False),'off')
            self.assertFalse(obj._ptt_enabled); self.assertEqual(states[-1],'LISTENING')
            scope['set_push_to_talk'](obj,True,suspended=True)
            obj._on_ptt(True); self.assertFalse(obj._ptt_held)
            scope['set_push_to_talk'](obj,True,suspended=False)
            obj._on_ptt(True); self.assertTrue(obj._ptt_held)
            scope['set_push_to_talk'](obj,True,suspended=False)  # Heartbeats/config repeats do not release a held key.
            self.assertTrue(obj._ptt_held)
            scope['set_push_to_talk'](obj,False)
            self.assertFalse(obj._ptt_held); self.assertEqual(states[-1],'LISTENING')
        obj.ui.muted = False; obj._ptt_enabled = False
        scope['_on_ptt'](obj, True)
        self.assertFalse(obj._ptt_held)
