"""Native WAV package round trip in a private fixture, never production sounds or game packages."""
import base64
import io
import math
import struct
import sys
import tempfile
import wave
from contextlib import ExitStack
from pathlib import Path
from unittest.mock import patch

KIT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(KIT), str(KIT / 'editor')]
import kit
import live
import settings
import sounds


with tempfile.TemporaryDirectory(dir=KIT / 'backup', prefix='sound-engine-') as temp, ExitStack() as stack:
    root = Path(temp)
    package = 'UCUIAudioFixture'
    for folder in ('sources', 'dubs', 'dist', 'packages'):
        (root / folder).mkdir()
    for target, key, value in [
        (sounds, 'SOURCES', root / 'sources'), (sounds, 'DUBS', root / 'dubs'),
        (sounds, 'DIST', root / 'dist' / (package + '.u')), (sounds, 'CACHE', root / 'cache'),
        (sounds, 'PACKAGE', package), (settings, 'PACKAGES_DIR', root / 'packages'),
        (kit, 'RUNS', root / 'runs'),
    ]: stack.enter_context(patch.object(target, key, value))
    stack.enter_context(patch.object(live, 'running', return_value=False))
    stream = io.BytesIO()
    samples = b''.join(struct.pack('<h', round(4000 * math.sin(2 * math.pi * 440 * i / 44100))) for i in range(11025))
    with wave.open(stream, 'wb') as output:
        output.setnchannels(1); output.setsampwidth(2); output.setframerate(44100)
        output.writeframes(samples)
    original = stream.getvalue()
    ok, lines, names = sounds.import_sounds([dict(name='FixtureTone', source='generated-tone.wav',
                                                wav=base64.b64encode(original).decode())])
    assert ok, lines
    assert (root / 'packages' / (package + '.u')).read_bytes() == sounds.DIST.read_bytes()
    preview = sounds.playable(names[0])
    assert preview['seconds'] == .25 and preview['channels'] == 1 and preview['sample_rate'] == 44100 and preview['bits'] == 16
    assert preview['source'] == 'generated-tone.wav' and preview['origin'] == 'imported'
    assert (sounds.CACHE / 'play' / (names[0] + '.wav')).read_bytes() == original
    session = kit.Session([sounds.DIST], 'audio-export-proof')
    try:
        session.batch([r'OBJ LOAD FILE="..\Input\%s.u"' % package,
                       r'OBJ EXPORT TYPE=Sound NAME=%s FILE="..\Output\exported.wav"' % names[0]])
        exported = (session.folder / 'Output' / 'exported.wav').read_bytes()
    finally:
        session.close()
    with wave.open(io.BytesIO(exported), 'rb') as output:
        assert output.getnchannels() == 1 and output.getsampwidth() == 2 and output.getframerate() == 44100
        assert output.readframes(output.getnframes()) == samples, 'the package preserves every PCM sample'
    # Also exercise the cached game-package preview metadata on the actual engine export.
    exported_name = package + '.ExportedTone'
    (sounds.CACHE / 'play' / (exported_name + '.wav')).write_bytes(exported)
    with patch.object(sounds, 'PACKAGE', 'UnrelatedOwnNamespace'):
        result = sounds.playable(exported_name)
    assert result['origin'] == 'game' and result['source'] == package and result['seconds'] == .25
    assert result['channels'] == 1 and result['sample_rate'] == 44100 and result['bits'] == 16
    print('PASS native AUDIO IMPORT/package save/install (private fixture), browser preview metadata, OBJ EXPORT and exact PCM samples', flush=True)
print('PASS audio engine fixture removed; production sources, packages and game assets unchanged', flush=True)
