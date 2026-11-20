"""editor/app_update.py: which GitHub releases count as newer, and that an installed copy only offers those (no network:
the API answer is made up here)."""
import json
import os
import sys
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT), str(ROOT / 'editor')]
import app_update  # noqa: E402


def release(version, asset=True, draft=False, digest=True):
    assets = []
    if asset:
        assets.append(dict(name='DeusEdix-Setup-%s.exe' % version, size=1000,
                           browser_download_url='https://github.com/x/releases/download/v%s/DeusEdix-Setup-%s.exe' % (version, version)))
    if asset and digest:
        assets.append(dict(name='DeusEdix-Setup-%s.exe.sha256.txt' % version, size=90,
                           browser_download_url='https://github.com/x/releases/download/v%s/sha.txt' % version))
    return dict(tag_name='v' + version, name='DeusEdix ' + version, body='DeusEdix %s\n\n- notes' % version,
                html_url='https://github.com/x/releases/tag/v' + version, draft=draft, assets=assets)


API = [release('0.1.75'), release('0.1.74'), release('0.1.76', draft=True), release('0.1.77', asset=False),
       release('0.1.73'), dict(tag_name='nightly', assets=[])]


class AppUpdate(unittest.TestCase):
    def setUp(self):
        app_update._cache.clear()
        self.get = mock.patch.object(app_update, '_get', return_value=json.dumps(API).encode()).start()
        self.addCleanup(mock.patch.stopall)

    def check(self, version):
        with mock.patch.dict(os.environ, DEUSEDIX_UPDATE_TEST_VERSION=version):
            return app_update.check()

    def test_newer_with_installer_only(self):
        info = self.check('0.1.73')
        self.assertTrue(info['available'])
        self.assertEqual(info['latest'], '0.1.75')
        self.assertEqual([r['version'] for r in info['releases']], ['0.1.75', '0.1.74'])   # no draft, no asset-less

    def test_up_to_date(self):
        info = self.check('0.1.75')
        self.assertFalse(info['available'])
        self.assertEqual(info['releases'], [])

    def test_one_request_per_hour(self):
        self.check('0.1.73'); self.check('0.1.74')
        self.assertEqual(self.get.call_count, 1)

    def test_offline(self):
        self.get.side_effect = OSError('no network')
        info = self.check('0.1.73')
        self.assertFalse(info['available'])
        self.assertIn('GitHub could not be reached', info['error'])

    def test_development_copy_never_checks(self):
        with mock.patch.dict(os.environ, {}, clear=False):
            os.environ.pop('DEUSEDIX_UPDATE_TEST_VERSION', None)
            with mock.patch.object(app_update.settings, 'APP_ROOT', Path(__file__).parent):   # no deusedix.json there
                self.assertEqual(app_update.check(), dict(current=None, available=False, installed=False))
        self.get.assert_not_called()

    def test_download_refuses_older(self):
        with mock.patch.dict(os.environ, DEUSEDIX_UPDATE_TEST_VERSION='0.1.74'):
            with self.assertRaises(ValueError):
                app_update.download('0.1.73')

    def test_versions(self):
        self.assertGreater(app_update.version_tuple('v0.1.10'), app_update.version_tuple('0.1.9'))
        self.assertIsNone(app_update.version_tuple('latest'))


if __name__ == '__main__':
    unittest.main()
