import unittest
from unittest.mock import patch
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'engine'))
from core import entitlements

class LaunchEntitlements(unittest.TestCase):
    def test_free_and_paid_dispatch(self):
        free={'local':True,'gemini':False,'productivity':False,'partner':True,'listenTogether':False}
        entitlements.authorize('manage_schedule',caps=free)
        entitlements.authorize('control_app',{'action':'music','command':'play'},free)
        for name,args in [('productivity_manager',{}),('screen_process',{}),('control_app',{'command':'join'}),('computer_control',{})]:
            with self.assertRaises(PermissionError):entitlements.authorize(name,args,free)
        paid={key:True for key in free}
        entitlements.authorize('screen_process',caps=paid)
        entitlements.authorize('control_app',{'command':'join'},paid)
        with self.assertRaises(PermissionError):entitlements.authorize('computer_control',caps=paid)

    def test_dispatch_fails_closed_when_desktop_verification_is_unavailable(self):
        with patch.object(entitlements,'request',side_effect=RuntimeError('Offline RPC')):
            with self.assertRaises(RuntimeError):entitlements.require('gemini')

    def test_discovery_matches_verified_capabilities(self):
        with patch.object(entitlements,'capabilities',return_value={'local':True,'productivity':False}):
            tools=entitlements.filter_tools([{'name':'computer_control'},{'name':'productivity_manager'},{'name':'manage_schedule'}])
        self.assertEqual([t['name'] for t in tools],['manage_schedule'])

if __name__=='__main__':unittest.main()
