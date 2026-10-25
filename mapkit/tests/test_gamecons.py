"""Synthetic conversation graphs: no original dialogue/audio is embedded in the tests."""
import sys
import unittest
from pathlib import Path

KIT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(KIT / 'editor'), str(KIT), str(KIT.parent)]
import gamecons


def row(kind, name, **props):
    return dict(path='Test.' + name, **{'class': kind}, properties=props)


def graph():
    return [
        row('ConversationList', 'm1', missionNumber='1', missionDescription='First', conversations="ConItem'Test.i1'"),
        row('ConversationList', 'm2', missionNumber='2', missionDescription='Second', conversations="ConItem'Test.i2'"),
        row('ConItem', 'i1', ConObject="Conversation'Test.con'", Next='None'),
        row('ConItem', 'i2', ConObject="Conversation'Test.con'", Next='None'),
        row('Conversation', 'con', conName='SharedGreeting', conOwnerName='Tester', audioPackageName='Test',
            eventList="ConEventSpeech'Test.e1'", flagRefList="ConFlagRef'Test.f'"),
        row('ConFlagRef', 'f', flagName='TestFlag', value='True', expiration='2', nextFlagRef='None'),
        row('ConEventSpeech', 'e1', speakerName='Tester', speakingToName='JCDenton', ConSpeech="ConSpeech'Test.s'",
            nextEvent="ConEventChoice'Test.e2'", Label='hello'),
        row('ConSpeech', 's', Speech='A quote: "hello"\nAnd a second line.\u2028Unicode too.', soundID='42'),
        row('ConEventChoice', 'e2', choiceList="ConChoice'Test.choice'", nextEvent='None'),
        row('ConChoice', 'choice', choiceText='Answer', choiceLabel='accepted', soundID='-1',
            skillNeeded="Class'DeusEx.SkillComputer'", skillLevelNeeded='2', flagRef="ConFlagRef'Test.f'", nextChoice='None'),
    ]


class ConversationGraphs(unittest.TestCase):
    def test_shared_missions_and_dependencies_are_preserved(self):
        result = gamecons.normalize(graph())
        con = result['conversations'][0]
        self.assertEqual(con['missions'], [1, 2])
        self.assertEqual(con['requires'], [dict(flag='TestFlag', value=True, expiration=2)])
        choice = con['events'][1]['choices'][0]
        self.assertEqual(choice['skill'], 'DeusEx.SkillComputer')
        self.assertEqual(choice['skillLevel'], 2)
        self.assertEqual(choice['flags'], con['requires'])
        self.assertEqual(result['byOwner']['tester'], ['Test.con'])
        self.assertEqual(result['bySpeaker']['tester'], ['Test.con'])
        self.assertEqual(con['events'][0]['text'], graph()[7]['properties']['Speech'])

    def test_cycle_is_an_error_not_a_hang_or_silent_truncation(self):
        rows = graph(); rows[8]['properties']['nextEvent'] = "ConEventSpeech'Test.e1'"
        with self.assertRaisesRegex(ValueError, 'Cyclic'):
            gamecons.normalize(rows)

    def test_missing_reference_is_not_silently_lost(self):
        rows = graph(); rows[6]['properties']['ConSpeech'] = "ConSpeech'Test.absent'"
        with self.assertRaisesRegex(ValueError, 'Unresolved'):
            gamecons.normalize(rows)

    def test_package_and_map_paths_are_not_accepted(self):
        for value in ('../../Private', 'RevisionConversations.u', 'FNotAPackage'):
            with self.assertRaises(ValueError):
                gamecons.catalog(value)
        with self.assertRaises(ValueError):
            gamecons.for_map('../private', [])

    def test_audio_without_id3_is_not_mislabeled_as_wav(self):
        self.assertEqual(gamecons.audio_format(b'\xff\xfb\x30\xc4' + b'\0'*8), ('mp3', 'audio/mpeg'))
        self.assertEqual(gamecons.audio_format(b'ID3' + b'\0'*9), ('mp3', 'audio/mpeg'))
        self.assertEqual(gamecons.audio_format(b'RIFF\0\0\0\0WAVE'), ('wav', 'audio/wav'))
        self.assertEqual(gamecons.audio_format(b'OggS' + b'\0'*8), ('ogg', 'audio/ogg'))
        with self.assertRaises(ValueError):
            gamecons.audio_format(b'not audio')

    def test_catalog_reads_the_engine_dump_and_keeps_a_copy(self):
        # the host's session is faked: the conversations it dumps, the voice it resolves (UC_CONDUMP, UC_CONSOUND)
        import json
        import tempfile
        from unittest import mock

        def lines(values):
            return ''.join(json.dumps(v) + '\n' for v in values)

        with tempfile.TemporaryDirectory() as tmp:
            class Session:
                def __init__(self, maps, name):
                    self.folder = Path(tmp) / 'session'
                    (self.folder / 'Output').mkdir(parents=True, exist_ok=True)

                def batch(self, commands):
                    out = self.folder / 'Output'
                    if any(c.startswith('UC_CONDUMP') for c in commands):
                        (out / 'conversations.jsonl').write_text(lines(graph()), encoding='utf-8')
                    if any(c.startswith('UC_CONSOUND') for c in commands):
                        (out / 'soundrefs.jsonl').write_text(lines([{'sound': 'TestAudio.Test_42', 'id': 42}]), encoding='utf-8')

                def close(self):
                    pass

            with mock.patch.object(gamecons.kit, 'Session', Session), \
                    mock.patch.object(gamecons, 'CACHE', Path(tmp) / 'cache'), \
                    mock.patch.object(gamecons, '_files', lambda package: []), \
                    mock.patch.object(gamecons, '_stamp', lambda files: 'signature'), \
                    mock.patch.object(gamecons, 'conversation_set', lambda package: ('TestText', 'TestAudio')), \
                    mock.patch.object(gamecons, '_sound_names', lambda files, any_name=False: {'TestAudio.Test_42'}), \
                    mock.patch.dict(gamecons._memory, clear=True):
                result = gamecons.catalog('TestConversations', log=lambda *a: None)
            self.assertEqual(result['conversations'][0]['events'][0]['sound'], 'TestAudio.Test_42')
            self.assertEqual((Path(tmp) / 'cache' / 'TestConversations.jsonl').read_text(encoding='utf-8'), lines(graph()))


if __name__ == '__main__':
    unittest.main()
