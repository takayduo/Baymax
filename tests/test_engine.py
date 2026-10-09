import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'engine'))
from core import confirm
from core.action_loader import ActionRecord, ActionRegistry
from memory import config_manager

class EngineRegressions(unittest.TestCase):
    def tearDown(self):
        confirm.resolve(False)
        confirm.bind(None, None)

    def test_confirmation_wrong_id_and_expiry_never_execute(self):
        calls = []
        confirm.bind(lambda *args: None, lambda: None)
        with patch.object(confirm.time, 'monotonic', return_value=100):
            confirm.request('test', 'Test', 'Test only', lambda: calls.append('executed'))
        request_id = confirm.pending_id()
        confirm.resolve(True, 'stale-id')
        self.assertEqual(confirm.pending_id(), request_id)
        with patch.object(confirm.time, 'monotonic', return_value=191):
            confirm.resolve(True, request_id)
        self.assertEqual(calls, [])
        self.assertIsNone(confirm.pending_id())

    def test_confirmation_without_ui_is_refused(self):
        confirm.bind(None, None)
        result = confirm.request('test', 'Test', 'Test only', lambda: self.fail('must not execute'))
        self.assertIn('have not done it', result)

    def test_action_failures_are_not_success(self):
        def broken(parameters):
            raise RuntimeError('disk unavailable')
        handlers = {'error': broken, 'refusal': lambda parameters: 'I cannot confirm this.', 'typed': lambda parameters: {'success': False, 'error': 'offline'}}
        registry = ActionRegistry({name: ActionRecord(name=name, handler=handler, valid=True) for name, handler in handlers.items()}, lambda message: None)
        for name in [*handlers, 'unknown']:
            self.assertFalse(registry.run_result(name, {})['success'])

    def test_environment_key_is_used_without_a_config_file(self):
        with patch.object(config_manager, 'CONFIG_FILE', Path(__file__).parent / 'nonexistent-config.json'), patch.dict('os.environ', {'GEMINI_API_KEY': 'test-only-key'}):
            self.assertEqual(config_manager.get_gemini_key(), 'test-only-key')

if __name__ == '__main__':
    unittest.main()
