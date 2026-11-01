"""Imports preserve existing sources, validate whole batches and report useful audio metadata."""
import base64
import io
import json
import sys
import tempfile
import unittest
import wave
from pathlib import Path
from unittest.mock import patch

KIT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(KIT), str(KIT / 'editor')]
import sounds


def wav(samples=441, channels=1):
    stream = io.BytesIO()
    with wave.open(stream, 'wb') as output:
        output.setnchannels(channels); output.setsampwidth(2); output.setframerate(44100)
        output.writeframes(b'\x00\x10' * samples * channels)
    return stream.getvalue()


def item(name='Rain', data=None):
    return dict(name=name, source='rain-original.mp3', wav=base64.b64encode(wav() if data is None else data).decode())


class SoundImportTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir=KIT / 'tests', prefix='sounds-')
        self.root = Path(self.temp.name)
        self.source = self.root / 'sounds'; self.source.mkdir()
        self.dubs = self.root / 'dubs'; self.dubs.mkdir()
        self.patches = [patch.object(sounds, 'SOURCES', self.source), patch.object(sounds, 'DUBS', self.dubs),
                        patch.object(sounds, 'CACHE', self.root / 'cache')]
        for p in self.patches: p.start()

    def tearDown(self):
        for p in reversed(self.patches): p.stop()
        self.temp.cleanup()

    def test_existing_and_duplicate_batch_names_are_kept(self):
        existing = self.source / 'Rain.wav'; existing.write_bytes(b'original bytes')
        (self.dubs / 'D123.wav').write_bytes(b'voice bytes')
        with patch.object(sounds, 'pack', return_value=(True, ['built'])):
            ok, lines, names = sounds.import_sounds([item('rain'), item('rain'), item('D123')])
        self.assertTrue(ok)
        self.assertEqual([n.split('.')[-1] for n in names], ['rain_2', 'rain_3', 'D123_2'])
        self.assertEqual(existing.read_bytes(), b'original bytes')
        self.assertEqual((self.dubs / 'D123.wav').read_bytes(), b'voice bytes')
        self.assertEqual(len(lines), 4)

    def test_invalid_later_file_does_not_partially_import(self):
        with patch.object(sounds, 'pack') as pack:
            with self.assertRaises(ValueError):
                sounds.import_sounds([item(), item('Bad', wav()[:-4])])
            pack.assert_not_called()
        self.assertEqual(list(self.source.iterdir()), [])

    def test_failed_pack_restores_sources_and_index(self):
        before = b'{"Existing":{"source":"original.wav"}}'
        index = self.source / 'index.json'; index.write_bytes(before)
        for error in (False, True):
            kwargs = {'side_effect': RuntimeError('engine failed')} if error else {'return_value': (False, ['failed'])}
            with patch.object(sounds, 'pack', **kwargs):
                if error:
                    with self.assertRaises(RuntimeError): sounds.import_sounds([item()])
                else:
                    self.assertEqual(sounds.import_sounds([item()]), (False, ['failed'], []))
            self.assertEqual(index.read_bytes(), before)
            self.assertEqual(list(self.source.glob('*.wav')), [])

    def test_metadata_catalog_and_preview(self):
        with patch.object(sounds, 'pack', return_value=(True, [])):
            _, _, names = sounds.import_sounds([item()])
        entry = sounds.own()[0]
        preview = sounds.playable(names[0])
        for result in (entry, preview):
            self.assertEqual(result['source'], 'rain-original.mp3')
            self.assertEqual(result['channels'], 1)
            self.assertEqual(result['sample_rate'], 44100)
            self.assertEqual(result['bits'], 16)
            self.assertEqual(result['seconds'], .01)
            self.assertEqual(result['bytes'], len(wav()))

    def test_wav_rejects_empty_stereo_and_bad_headers(self):
        for raw in (wav(0), wav(channels=2), b'RIFF', wav()[:20], b'not audio'):
            with self.subTest(raw=raw[:16]), self.assertRaises(ValueError):
                sounds.import_sounds([item(data=raw)])

    def test_header_only_metadata_handles_long_valid_wav(self):
        full = wav(60000)
        self.assertAlmostEqual(sounds._wav_info(full[:65536], complete=False)[3], 60000 / 44100)
        with self.assertRaises(ValueError): sounds._wav_info(full[:65536])


if __name__ == '__main__':
    unittest.main()
