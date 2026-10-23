import copy, sys, unittest
from pathlib import Path
HERE=Path(__file__).resolve().parent
sys.path[:0]=[str(HERE/'staged'),str(HERE.parent/'editor'),str(HERE.parent/'deusedix-mission-graph')]
from mission_graph import Graph

def document(body):
    return dict(project={},maps=[dict(name='03_NYC_UNATCOHQ',actors=[],complete=True)],scripts=[
        dict(path='DeusEx.AnnaNavarre',parent='ScriptedPawn',text='',headerOnly=True),
        dict(path='DeusEx.WaltonSimons',parent='ScriptedPawn',text='',headerOnly=True),
        dict(path='DeusEx.Mission03',parent='MissionScript',text='class Mission03 extends MissionScript; function Timer(){ local AnnaNavarre Anna; local WaltonSimons Walton; '+body+' }')])

class RulesTests(unittest.TestCase):
    def build(self,body):
        doc=document(body);before=copy.deepcopy(doc);r=Graph(doc).result()['rules'];self.assertEqual(before,doc);return r['items']
    def test_siblings_not_anna(self):
        rules=self.build('if(localURL=="03_NYC_UNATCOHQ") { if(flags.GetBool(\'AnnaAtDesk\')) { foreach AllActors(class\'AnnaNavarre\',Anna) Anna.SetHomeBase(Anna.Location,Anna.Rotation); flags.SetBool(\'DeskDone\',True,,4); } if(flags.GetBool(\'Other\')) Walton.Destroy(); }')
        anna=[r for r in rules if 'class:annanavarre' in r['subjects']]
        self.assertEqual(len(anna),1);self.assertEqual(anna[0]['reads'],['AnnaAtDesk']);self.assertEqual(anna[0]['writes'],['DeskDone']);self.assertEqual(anna[0]['maps'],['03_NYC_UNATCOHQ'])
    def test_negation_and_else(self):
        rules=self.build('if(flags.GetBool(\'A\') || !flags.GetBool(\'B\')) flags.SetBool(\'C\',True); else if(flags.GetBool(\'D\')) flags.SetBool(\'E\',False);')
        r=next(r for r in rules if 'E' in r['writes']);self.assertEqual(r['reads'],['A','B','D']);self.assertTrue(r['conditions'][0].startswith('NOT ('));self.assertIn('||',r['conditions'][0])
    def test_no_map_inference_from_or(self):
        rules=self.build('if(localURL=="03_NYC_UNATCOHQ" || flags.GetBool(\'AnyMap\')) flags.SetBool(\'X\',True);')
        self.assertEqual(rules[0]['maps'],[]);self.assertEqual(rules[0]['mapScope'],'map unresolved')
    def test_comments_strings_dynamic(self):
        rules=self.build('Log("flags.SetBool(\'Fake\', True)"); /* flags.GetBool(\'Hidden\'); */ flags.SetBool(computed,True); flags.GetBool(\'Real\');')
        self.assertEqual([f for r in rules for f in r['reads']],['Real']);self.assertFalse(any(r['writes'] for r in rules));self.assertTrue(any('Computed' in n for r in rules for n in r['notes']))
    def test_unconditional_siblings_separate(self):
        rules=self.build("foreach AllActors(class'AnnaNavarre',Anna) Anna.EnterWorld(); flags.SetBool('Other',True);")
        self.assertFalse(any('class:annanavarre' in r['subjects'] and 'Other' in r['writes'] for r in rules))
    def test_global_character_reference(self):
        doc=document("if(flags.GetBool('Ready')) Anna.EnterWorld();")
        row=doc['scripts'][-1];row['text']=row['text'].replace('function Timer()', 'var AnnaNavarre Anna; function Timer()').replace('local AnnaNavarre Anna;','')
        self.assertIn('class:annanavarre',Graph(doc).result()['rules']['items'][0]['subjects'])
    def test_return_partial(self):
        rules=self.build('if(flags.GetBool(\'A\')) return; flags.SetBool(\'B\',True);')
        self.assertTrue(any('Partial control flow' in n for n in rules[0]['notes']))
    def test_switch_unverified(self):
        r=self.build('switch(x) { case 1: flags.SetBool(\'A\',True); break; case 2: flags.SetBool(\'B\',False); break; }')[0]
        self.assertTrue(any('Partial control flow' in n for n in r['notes']))
    def test_conversation_events_separate(self):
        doc=document('');doc['conversations']=[dict(name='AnnaTalk',owner='AnnaNavarre',missions=[3],requires=[dict(flag='Ready',value=True)],events=[dict(type='SetFlag',flags=[dict(flag='A',value=True)]),dict(type='CheckFlag',flags=[dict(flag='B',value=False)])])]
        rules=Graph(doc).result()['rules']['items'];self.assertEqual(len(rules),3)
        self.assertEqual([r['writes'] for r in rules],[[],['A'],[]]);self.assertTrue(all(r['maps']==[] for r in rules));self.assertTrue(all(r['missions']==['Mission 03'] for r in rules))
    def test_stable_ids(self):
        self.assertEqual(self.build("flags.SetBool('A',True);"),self.build("flags.SetBool('A',True);"))
    def test_authored_rule_scope(self):
        doc=document('');doc['maps'][0]['story']={'events':[{'id':'test','title':'Door access','when':{'type':'flag','flag':'Ready'},'actions':[{'type':'flag','a':'Open'}]}]}
        r=Graph(doc).result()['rules']['items'][0]
        self.assertEqual(r['reads'],['Ready']);self.assertEqual(r['writes'],['Open']);self.assertEqual(r['mapScope'],'authored map')
    def test_loop_is_preserved(self):
        r=self.build("while(flags.GetBool('A')) flags.SetBool('B',True);")[0]
        self.assertEqual(r['reads'],['A']);self.assertIn('while',r['loops'][0])

if __name__=='__main__':unittest.main()
