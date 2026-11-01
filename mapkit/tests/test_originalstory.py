"""Synthetic fixtures only: original game dialogue/audio stays in local caches."""
import copy
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

KIT=Path(__file__).resolve().parents[1]
sys.path[:0]=[str(KIT),str(KIT/'editor'),str(KIT.parent)]
import originalstory
import story
import sounds
import gamecons


def conversation():
    return dict(path='RevisionConversationsText.Conversation123',name='Synthetic',owner='Tester',
        properties=dict(binvokesight='True',binvokefrob='False',bdisplayonce='True',bdatalinkcon='False'),
        requires=[dict(flag='Ready',value=True,expiration=2)],events=[
            dict(path='Test.speech',type='Speech',label='Start',speaker='Tester',speakingTo='JCDenton',text='Synthetic speech',
                 sound='RevisionConversationsAudioMission01.ConAudioMission01_123',properties={}),
            dict(path='Test.choice',type='Choice',label='',properties={},choices=[dict(text='Synthetic answer',label='END',
                 skill='DeusEx.SkillComputer',skillLevel=2,flags=[dict(flag='Ready',value=True,expiration=2)],
                 sound=None,properties={'bdisplayasspeech':'True'})]),
            dict(path='Test.end',type='End',label='End',properties={})])


class OriginalStories(unittest.TestCase):
    def test_copy_keeps_binding_activation_flags_choice_and_voice(self):
        source=conversation(); untouched=copy.deepcopy(source)
        d=originalstory.convert(source,'Tester0','RevisionConversations')['dialogue']
        self.assertEqual(source,untouched)
        self.assertEqual((d['replaces'],d['bind'],d['native']['binvokesight']),('Synthetic','Tester','True'))
        self.assertEqual(d['steps'][1]['voice']['speaker'],'Tester')
        self.assertEqual(d['steps'][2]['options'][0]['requires'][0]['expiration'],2)
        code=story.generate('TestMap',{'dialogues':[d]})
        self.assertIn("ReplaceCon(A, 'Synthetic', c.con)",code)
        self.assertIn('c.AnswerDetails("DeusEx.SkillComputer", 2, True)',code)
        self.assertIn('VoiceRef("Tester", "Synthetic speech",',code)
        self.assertIn('c.NativeEvent(\'Comment\')',code) # consecutive label aliases have a real target

    def test_radio_switch_off_does_not_register_old_references(self):
        source=conversation();source['properties']['bdatalinkcon']='True'
        d=originalstory.convert(source,'@player','RevisionConversations',True)['dialogue']
        code=story.generate('TestMap',{'dialogues':[d]})
        self.assertIn('A = Plr();',code);self.assertIn("ReplaceCon(A, 'Synthetic');",code)
        self.assertNotIn('c.Begin(',code);self.assertNotIn('VoiceRef(',code)

    def test_cross_conversation_jump_is_preserved(self):
        c=conversation();c['events'].insert(0,dict(path='Test.jump',type='Jump',label='',properties={
            'jumplabel':'Elsewhere','jumpcon':"Conversation'RevisionConversationsText.Conversation124'"}))
        result=originalstory.convert(c,'Tester0','RevisionConversations')
        self.assertEqual(result['losses'],[])
        code=story.generate('TestMap',{'dialogues':[result['dialogue']]})
        self.assertIn('c.JumpOriginal(Self, "RevisionConversationsText.Conversation124")',code)
        self.assertGreater(code.index('RebindCopyJumps();'),code.index('c.JumpOriginal('))

    def test_all_additional_event_types_preserve_native_properties(self):
        kinds={'AddCredits':{'creditstoadd':'-25'},'AddSkillPoints':{'pointstoadd':'30','awardmessage':'Synthetic award'},
               'CheckObject':{'objectname':'DeusEx.WeaponPistol','faillabel':'End'},
               'CheckPersona':{'personatype':'EP_Health','condition':'EC_Less','value':'20','jumplabel':'End'},
               'Animation':{'eventownername':'Tester','sequence':'Wave','playlength':'2','bfinishanim':'True'},
               'Trade':{'eventownername':'Tester'},'AddNote':{'notetext':'Synthetic note'},
               'RandomLabel':{'bcycleevents':'True','bcycleonce':'True','bcyclerandom':'False'}}
        c=conversation()
        c['events']=[dict(path='Test.'+k,type=k,label='',properties=v,labels=['Start','End']) for k,v in kinds.items()]+c['events']
        code=story.generate('TestMap',{'dialogues':[originalstory.convert(c,'Tester0','RevisionConversations')['dialogue']]})
        for k in kinds:
            if k!='RandomLabel': self.assertIn("c.NativeEvent('%s')"%k,code)
        self.assertIn('c.RandomBegin(Self, True, True, False)',code)
        self.assertIn('c.LastProp("creditsToAdd", "-25")',code)

    def test_long_original_line_remains_one_speech(self):
        c=conversation();c['events'][0]['text']='A long synthetic sentence. '*30
        d=originalstory.convert(c,'Tester0','RevisionConversations')['dialogue']
        code=story.generate('TestMap',{'dialogues':[d]})
        self.assertEqual(code.count('c.Line('),1)
        self.assertIn(' $ ',code)

    def test_changed_reference_text_is_cleared_without_importing_audio(self):
        d=originalstory.convert(conversation(),'Tester0','RevisionConversations')['dialogue'];data={'dialogues':[d]}
        with patch.object(sounds,'_dub_index',return_value={}),patch.object(sounds,'pack',side_effect=AssertionError('must not package original audio')):
            sounds.rekey(data)
            self.assertIsInstance(d['steps'][1]['voice'],dict)
            d['steps'][1]['text']='Changed synthetic text';sounds.rekey(data)
            self.assertNotIn('voice',d['steps'][1])

    def test_original_dub_resolves_trusted_source_speaker_and_text(self):
        c=conversation();c['events'][0]['text']='Native source'
        body={'original':{'package':'RevisionConversations','conversation':c['path'],'event':'Test.speech'},'line':{'text':'untrusted'}}
        with patch.object(gamecons,'catalog',return_value={'conversations':[c]}):
            self.assertEqual(sounds._speaker(body),'Tester');self.assertEqual(body['line']['text'],'Native source')

    def test_invalid_overrides_and_new_missing_targets_fail(self):
        d=originalstory.convert(conversation(),'Tester0','RevisionConversations')['dialogue']
        d['replaces']="Bad'); injected"
        with self.assertRaises(ValueError): story.generate('TestMap',{'dialogues':[d]})
        d['replaces']='Synthetic';d['steps'][2]['options'][0]['goto']='Missing'
        with self.assertRaisesRegex(ValueError,'Unknown label'): story.generate('TestMap',{'dialogues':[d]})

    def test_dub_delete_rolls_back_failed_package_build(self):
        with tempfile.TemporaryDirectory() as folder:
            file=Path(folder)/'D123.wav';file.write_bytes(b'local-user-take')
            with patch.object(sounds,'DUBS',Path(folder)),patch.object(sounds,'pack',return_value=(False,['failure'])):
                ok,_=sounds.dub_delete('D123')
            self.assertFalse(ok);self.assertEqual(file.read_bytes(),b'local-user-take')

    def test_recording_again_from_copy_keeps_existing_native_dub(self):
        key=story.raw_voice_key('Tester','Synthetic speech')
        original={'package':'RevisionConversations','conversation':'Synthetic','event':'SyntheticSpeech'}
        with tempfile.TemporaryDirectory() as folder:
            with patch.object(sounds,'DUBS',Path(folder)), patch.object(sounds,'_speaker',return_value='Tester'), \
                 patch.object(sounds,'_wav_info',return_value=(1,22050,16,1)), \
                 patch.object(sounds,'_dub_index',return_value={key:{'original':original}}), \
                 patch.object(sounds,'_dub_save_index') as save, patch.object(sounds,'write_dub_registry'), \
                 patch.object(sounds,'pack',return_value=(True,[])):
                ok,_,_=sounds.dub({'dialogue':{'replaces':'Synthetic'},'line':{'text':'Synthetic speech'},'wav':'AA=='})
                self.assertTrue(ok)
                self.assertEqual(save.call_args[0][0][key]['original'],original)


if __name__=='__main__': unittest.main()
