"""Production speech/receive/playback code with fake devices and no API calls."""
import ast
import asyncio
from datetime import datetime
import json
import os
from pathlib import Path
from types import SimpleNamespace
import sys
import tempfile
import threading
import time
import traceback
import unittest
from unittest.mock import Mock, patch
import numpy as np
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'engine'))
from core.speech_control import SpeechControl
from memory import config_manager as config, memory_manager as memory
from actions import background_monitor as monitor
from actions.proactive import ProactiveEngine

source = Path(__file__).resolve().parents[1] / 'engine/main.py'
tree = ast.parse(source.read_text(encoding='utf-8'))
live = next(node for node in tree.body if isinstance(node, ast.ClassDef) and node.name == 'JarvisLive')
names = {'_receive_audio', '_play_audio', '_send_startup_briefing', '_on_text_command', 'set_speaking'}
methods = [node for node in live.body if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name in names]
scope = dict(asyncio=asyncio, time=time, datetime=datetime, traceback=traceback, np=np,
             _TAIL_MARGIN=.1, _REPEAT_MIN=8, _VIS_HOP=480, RECEIVE_SAMPLE_RATE=24000, CHANNELS=1,
             CHUNK_SIZE=1024, _CURSOR_SLACK=.1, _FIRST_SOUND=.04,
             _clean_transcript=lambda text: text.strip(), _is_repeat_chunk=lambda text, parts: text in parts,
             get_output_device=lambda: '', audio_devices=SimpleNamespace(resolve=lambda *args: None),
             _pcm_visemes=lambda *args, **kwargs: [(.4, .4, .4)], _pcm_level=lambda pcm: .4,
             load_memory=lambda: {}, pop_last_session=lambda: None)
exec(compile(ast.fix_missing_locations(ast.Module(body=methods, type_ignores=[])), str(source), 'exec'), scope)


class Session:
    def __init__(self):
        self.sent = []
        self.incoming = asyncio.Queue()
    async def send_client_content(self, **data):
        self.sent.append(data)
    async def send_tool_response(self, **data):
        self.sent.append(data)
    async def receive(self):
        while True:
            yield await self.incoming.get()


class Harness(SpeechControl):
    def __init__(self):
        self.ui = SimpleNamespace(muted=False, set_state=Mock(), push_visemes=Mock(),
                                  set_audio_level=Mock(), emit=Mock(spec=lambda event, data=None: None), write_log=Mock(), show_content=Mock())
        self._loop = asyncio.get_running_loop()
        self.session = Session()
        self._interrupted = False
        self._init_speech_control()
        self._awake, self._wake_enabled = True, False
        self._briefing_sent = False
        self._speaking_lock = threading.Lock()
        self._is_speaking = False
        self._out_latency, self._tail_until, self._play_cursor = .2, 0, 0
        self._visemes = SimpleNamespace(reset=Mock(), feed_text=Mock(), frames=lambda frames, hop: frames)
        self._echo = SimpleNamespace(note_output=Mock())
        self._last_user_speech = 0
        self._pending_vision = None
        self._turn_done_event = asyncio.Event()
        self.audio_in_queue, self.out_queue = asyncio.Queue(), asyncio.Queue()
        self._session_log = []
        self._dashboard, self._resume_handle = None, None
        self._last_out_logged, self._asst_name = '', 'Baymax'
        self._vision_close_pending = False
        self._execute_tool = Mock()
        self._fetch_partner_updates_sync = lambda: {'partnerName': 'Partner', 'newMessages': [], 'pendingTasks': []}
        self._session_tasks = SimpleNamespace(create_task=asyncio.create_task)
    async def _idle_job(self):
        await asyncio.Event().wait()
    _run_proactive_mode = _run_background_monitor = _run_system_monitor = _send_startup_briefing = _idle_job

for name in names - {'_send_startup_briefing'}:
    setattr(Harness, name, scope[name])


class SpeechTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory()
        root = Path(self.temp.name)
        self.patches = [patch.object(config, 'CONFIG_FILE', root / 'api_keys.json'),
                        patch.object(config, 'CONFIG_DIR', root),
                        patch.object(memory, 'MEMORY_PATH', root / 'memory.json')]
        for item in self.patches: item.start()
        self.h = Harness()

    async def asyncTearDown(self):
        tasks = list(self.h._background_tasks.values())
        self.h._cancel_background_tasks()
        if tasks: await asyncio.gather(*tasks, return_exceptions=True)
        for item in reversed(self.patches): item.stop()
        self.temp.cleanup()

    async def test_call_lock_blocks_new_prompts_and_background_until_call_ends(self):
        self.h._begin_user_turn()
        self.h.set_call_active(True)
        self.h._begin_user_turn()
        self.assertFalse(self.h._response_allowed())
        self.assertFalse(self.h._background_allowed())
        self.assertTrue(self.h.ui.muted)
        self.h.set_call_active(False)
        self.h.ui.muted = False
        self.assertFalse(self.h._response_allowed())
        self.h._begin_user_turn()
        self.assertTrue(self.h._response_allowed())

    async def test_voice_change_accepts_runner_argument_saves_and_reconnects(self):
        method = next(n for n in live.body if isinstance(n, ast.FunctionDef) and n.name == '_on_voice_change')
        namespace = {}
        exec(compile(ast.fix_missing_locations(ast.Module(body=[method], type_ignores=[])), str(source), 'exec'), namespace)
        target = SimpleNamespace(request_reconnect=Mock())
        for name in config.AVAILABLE_VOICES:
            namespace['_on_voice_change'](target, name)
            self.assertEqual(config.get_voice(), name)
        self.assertEqual(len(config.AVAILABLE_VOICES), 30)
        target.request_reconnect.assert_called_with(keep_context=False, reason='new voice')

    async def test_defaults_are_quiet_and_interests_persist_without_erasing_memory(self):
        config.CONFIG_FILE.write_text(json.dumps({'proactive_audio': True}), encoding='utf-8')
        memory.MEMORY_PATH.write_text(json.dumps({'identity': {'name': {'value': 'Owner'}}}), encoding='utf-8')
        self.assertFalse(config.get_proactive_talking_enabled())
        self.h._sync_background_tasks()
        self.assertEqual(self.h._background_tasks, {})
        self.assertFalse(await self.h._send_background('uninvited'))
        config.save_user_interests('  YouTube growth, psychology  ')
        self.assertEqual(config.get_user_interests(), 'YouTube growth, psychology')
        saved = json.loads(memory.MEMORY_PATH.read_text(encoding='utf-8'))
        self.assertEqual(saved['identity']['name']['value'], 'Owner')
        self.assertEqual(saved['preferences']['user_interests']['value'], config.get_user_interests())
        self.h.set_proactive_preferences(False, 'editing')
        await asyncio.sleep(0); await asyncio.sleep(0)
        self.assertIn('editing', self.h._interests_context())
        self.assertTrue(all(not item['turn_complete'] for item in self.h.session.sent))

    async def test_toggle_off_cancels_all_background_tasks_and_blocks_queued_injections(self):
        self.h.set_proactive_preferences(True, 'editing')
        await asyncio.sleep(0); await asyncio.sleep(0)
        self.assertEqual(set(self.h._background_tasks), {'proactive', 'news', 'system', 'briefing'})
        tasks = list(self.h._background_tasks.values())
        self.assertTrue(await self.h._send_background('authorized', 'editing'))
        self.h.set_proactive_preferences(False, 'editing')
        await asyncio.sleep(0); await asyncio.sleep(0)
        self.assertTrue(all(task.cancelled() for task in tasks))
        self.assertFalse(await self.h._send_background('too late', 'editing'))
        self.h.set_proactive_preferences(True, 'psychology')
        await asyncio.sleep(0); await asyncio.sleep(0)
        self.assertEqual(len(self.h._background_tasks), 3)
        self.assertFalse(await self.h._send_background('stale interests', 'editing'))
        self.h.interrupt()
        self.h.set_proactive_preferences(True, 'psychology')
        await asyncio.sleep(0)
        self.assertFalse(await self.h._send_background('must wait for user'))

    async def test_interrupt_discards_trailing_turns_and_only_new_user_audio_reopens(self):
        task = asyncio.create_task(self.h._receive_audio())
        def response(audio=b'pcm', complete=True):
            return SimpleNamespace(data=audio, tool_call=None, server_content=SimpleNamespace(
                output_transcription=SimpleNamespace(text='old reply'), input_transcription=None, turn_complete=complete))
        self.h._begin_user_turn()
        self.h.interrupt()
        await asyncio.sleep(0)
        for _ in range(3): await self.h.session.incoming.put(response())
        await asyncio.sleep(0)
        self.assertTrue(self.h._interrupted)
        self.assertTrue(self.h.audio_in_queue.empty())
        self.h._visemes.feed_text.assert_not_called()
        self.h._note_user_audio(0); self.h._note_user_audio(.3)
        self.assertTrue(self.h._interrupted)
        self.h._note_user_audio(.3)
        self.assertFalse(self.h._interrupted)
        await self.h.session.incoming.put(response(b'new audio'))
        await asyncio.sleep(0)
        epoch, data = self.h.audio_in_queue.get_nowait()
        self.assertEqual((epoch, data), (self.h._speech_epoch, b'new audio'))
        task.cancel()
        with self.assertRaises(asyncio.CancelledError): await task

    async def test_click_cancels_actual_phase_two_startup_briefing(self):
        self.h._proactive_talking_enabled = True
        task = asyncio.create_task(scope['_send_startup_briefing'](self.h))
        self.h._background_tasks['briefing'] = task
        for _ in range(100):
            if self.h.session.sent: break
            await asyncio.sleep(.01)
        self.assertEqual(len(self.h.session.sent), 1)
        self.h.interrupt()
        await asyncio.sleep(0); await asyncio.sleep(0)
        self.h._turn_done_event.set()
        await asyncio.sleep(.02)
        self.assertTrue(task.cancelled())
        self.assertEqual(len(self.h.session.sent), 1)
        self.h.ui.show_content.assert_not_called()

    async def test_playback_abort_flushes_the_device_and_stale_batches_cannot_restart_it(self):
        class Stream:
            active = False
            latency = .05
            def __init__(self): self.writes = []; self.aborts = 0; self.starts = 0
            def start(self): self.active = True; self.starts += 1
            def write(self, data):
                if not self.active: raise RuntimeError('Device aborted')
                self.writes.append(data)
            def abort(self): self.active = False; self.aborts += 1
            def stop(self): self.active = False
            def close(self): pass
        stream = Stream()
        scope['sd'] = SimpleNamespace(RawOutputStream=lambda **kwargs: stream)
        self.h._begin_user_turn()
        old_epoch = self.h._speech_epoch
        task = asyncio.create_task(self.h._play_audio())
        self.h.audio_in_queue.put_nowait((old_epoch, b'\1\0' * 480))
        for _ in range(30):
            if stream.writes: break
            await asyncio.sleep(.01)
        self.assertEqual(len(stream.writes), 1)
        self.h.interrupt()
        await asyncio.sleep(0)
        self.h.audio_in_queue.put_nowait((old_epoch, b'\2\0' * 480))
        await asyncio.sleep(.02)
        self.assertEqual((stream.aborts, stream.starts, len(stream.writes)), (1, 1, 1))
        self.h.ui.push_visemes.assert_called_with([], .02, unittest.mock.ANY)
        self.h.ui.set_audio_level.assert_called_with(0.0)
        self.h._begin_user_turn()
        self.h.audio_in_queue.put_nowait((self.h._speech_epoch, b'\3\0' * 480))
        for _ in range(30):
            if len(stream.writes) == 2: break
            await asyncio.sleep(.01)
        self.assertEqual((stream.starts, len(stream.writes)), (2, 2))
        task.cancel()
        try: await task
        except asyncio.CancelledError: pass

    async def test_typed_prompt_releases_click_latch_without_restarting_engine(self):
        self.h.interrupt()
        self.h._on_text_command('Hello again')
        await asyncio.sleep(0); await asyncio.sleep(0)
        self.assertFalse(self.h._interrupted)
        self.assertEqual(self.h.session.sent[-1]['turns']['parts'][0]['text'], 'Hello again')

    async def test_engine_replacement_keeps_the_manual_stop_until_a_new_prompt(self):
        with patch.dict(os.environ, {'BAYMAX_SPEECH_STOPPED': '1'}):
            self.h = Harness()
        self.h.set_proactive_preferences(True, 'editing')
        await asyncio.sleep(0)
        self.assertTrue(self.h._interrupted)
        self.assertEqual(self.h._background_tasks, {})
        self.assertFalse(await self.h._send_background('restart greeting'))
        self.h._begin_user_turn()
        self.assertTrue(self.h._response_allowed())

    async def test_news_queries_and_headlines_are_scoped_to_interests(self):
        existing = {'football': {'topic': 'football', 'last_check': ''},
                    'youtube': {'topic': 'YouTube growth', 'last_check': ''}}
        news = Mock(return_value=[{'title': 'Unrelated sports results'}, {'title': 'YouTube adds editing tools', 'snippet': 'Growth for channels'}])
        with patch.object(monitor, '_load', return_value=existing), patch.object(monitor, '_save'), patch('actions.web_search._ddg_news', news):
            self.assertEqual(monitor.check_all(''), [])
            news.assert_not_called()
            alerts = monitor.check_all('YouTube growth, editing')
            self.assertTrue(alerts)
            self.assertEqual(len(alerts), 1, 'One headline matching several interests must not be repeated')
            self.assertTrue(all('YouTube' in value and 'sports' not in value for value in alerts))
            self.assertTrue(all('football' not in call.args[0] for call in news.call_args_list))
        prompt = ProactiveEngine().build_prompt({}, monitors=['football', 'YouTube'], interests='YouTube, editing')
        self.assertNotIn('football', prompt)
        self.assertIn('YouTube, editing', prompt)
        self.assertIn('Never invent current news', prompt)
