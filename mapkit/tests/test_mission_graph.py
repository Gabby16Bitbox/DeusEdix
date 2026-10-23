import copy
from pathlib import Path
import sys
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'editor'))
from mission_graph import Graph, uncomment, code_mask

def fixture(target='revision'):
    return dict(project={'name':'UNATCO Continues' if target=='unatco' else target,'target':'revision' if target=='unatco' else target},
        maps=[dict(name='01_Test',complete=True,actors=[
            dict(name='Anna0',cls='AnnaNavarre',props={'BindName':'"AnnaNavarre"','Tag':'AnnaStory'}),
            dict(name='Button0',cls='Button1',props={'Event':'DoorTag'}),
            dict(name='Door0',cls='DeusExMover',props={'Tag':'DoorTag'}),
        ],story={},edits={}),dict(name='02_Later',complete=True,actors=[],story={},edits={})],
        scripts=[dict(path='DeusEx.AnnaNavarre',parent='DeusEx.ScriptedPawn',text=''),
          dict(path='Mission.Test',parent='DeusEx.MissionScript',origin='project' if target=='unatco' else 'original',text="""class Test extends MissionScript;
function Timer() {
 if (flags.GetBool('AnnaSpared')) {
  flags.SetBool('LaterMeeting', True);
 }
 flags.GetBool(computedName);
 foreach AllActors(class'AnnaNavarre', Anna) { }
 Level.Game.SendPlayer("02_Later#Start");
 // flags.SetBool('NotAFlag',True);
 s = "flags.GetBool('NotAFlagEither')";
}
""")],conversations=[dict(name='AnnaTalk',path='Con.AnnaTalk',owner='AnnaNavarre',requires=[{'flag':'LaterMeeting'}],events=[])],notices=[],coverage={})

class GraphTests(unittest.TestCase):
    def test_three_targets_share_the_model(self):
        for target in ['vanilla','revision','unatco']:
            result=Graph(fixture(target)).result()
            self.assertTrue(result['readOnly']);self.assertTrue(result['nodes']);self.assertTrue(result['edges'])
    def test_no_input_mutation(self):
        doc=fixture();before=copy.deepcopy(doc);Graph(doc).result();self.assertEqual(doc,before)
    def test_flags_directions_and_no_strings_or_comments(self):
        graph=Graph(fixture()).result();edges=graph['edges'];nodes={n['id']:n for n in graph['nodes']}
        self.assertTrue(any(e['source']=='flag:annaspared' and e['relation']=='reads state' for e in edges))
        self.assertTrue(any(e['target']=='flag:latermeeting' and e['relation']=='writes state' for e in edges))
        self.assertNotIn('flag:notaflag',nodes);self.assertNotIn('flag:notaflageither',nodes)
    def test_dynamic_and_actor_loops_remain_unverified(self):
        f=Graph(fixture()).result()['findings'];self.assertTrue(any(x['title']=='Dynamic state lookup' for x in f));self.assertTrue(any(x['title']=='Runtime actor selection' for x in f))
    def test_actor_instance_is_not_character_class(self):
        g=Graph(fixture()).result();ids={n['id'] for n in g['nodes']};self.assertIn('character:01_test/anna0',ids);self.assertIn('character-class:annanavarre',ids)
    def test_native_events_connect_to_native_tags(self):
        g=Graph(fixture()).result();self.assertTrue(any(e['source']=='object:01_test/button0' and e['target']=='engine-tag:01_test/doortag' for e in g['edges']))
    def test_story_interaction_reports_deleted_target(self):
        doc=fixture();doc['maps'][0]['actors'][0]['deleted']=True;doc['maps'][0]['edits']={'links':[{'id':'L1','src':'Button0','do':[{'verb':'friend','target':'Anna0'}]}]}
        f=Graph(doc).result()['findings'];self.assertTrue(any(x['severity']=='error' and x['title']=='Target was deleted' for x in f))
    def test_incomplete_scan_does_not_claim_missing_actor_is_broken(self):
        doc=fixture();doc['maps'][0]['complete']=False;doc['maps'][0]['edits']={'links':[{'id':'L1','do':[{'verb':'friend','target':'Missing'}]}]}
        self.assertTrue(any(f['severity']=='unknown' and f['title']=='Target not verified' for f in Graph(doc).result()['findings']))
    def test_manual_and_native_tags_have_separate_nodes(self):
        doc=fixture();doc['maps'][0]['edits']={'objectTags':{'Anna0':{'mode':'manual','value':'JOHN'}}};g=Graph(doc).result();ids={n['id'] for n in g['nodes']}
        self.assertIn('scripting-tag:01_test/john',ids);self.assertIn('engine-tag:01_test/annastory',ids)
    def test_source_evidence_line_and_function(self):
        g=Graph(fixture()).result();e=next(x for x in g['edges'] if x['target']=='flag:latermeeting' and x['relation']=='writes state');self.assertEqual(e['evidence']['line'],4);self.assertEqual(e['evidence']['function'],'Timer')
    def test_map_destination(self):
        self.assertTrue(any(e['target']=='map:02_later' and e['relation']=='travels to' for e in Graph(fixture()).result()['edges']))
    def test_event_when_state_is_read_not_written(self):
        doc=fixture();doc['maps'][0]['story']={'events':[{'id':'e1','when':{'type':'flag','flag':'WaitForIt'},'do':[{'type':'flag','flag':'Done'}]}]}
        edges=Graph(doc).result()['edges'];self.assertTrue(any(e['source']=='flag:waitforit' and e['relation']=='reads state' for e in edges));self.assertFalse(any(e['target']=='flag:waitforit' and e['relation']=='writes state' for e in edges))
    def test_custom_runtime_class_references_connect(self):
        doc=fixture('unatco');doc['scripts'].append(dict(path='Mod.Route',parent='Info',text="class Route extends Info; function BeginPlay(){ Spawn(class'Test'); }"))
        self.assertTrue(any(e['source']=='script:mod.route' and e['target']=='script:mission.test' and e['relation']=='references runtime logic' for e in Graph(doc).result()['edges']))
    def test_forward_reference_gets_definition_origin(self):
        doc=fixture('unatco');doc['scripts'].insert(0,dict(path='Mod.Route',parent='Info',origin='project',text="class Route extends Info; function BeginPlay(){ Spawn(class'Test'); }"))
        graph=Graph(doc).result();node=next(n for n in graph['nodes'] if n['id']=='script:mission.test');self.assertEqual(node['origin'],'project')
    def test_comments_in_strings_are_preserved(self):
        text='x="https://test"; // hidden\nflag.GetBool(\'yes\');';self.assertIn('https://test',uncomment(text));self.assertNotIn('hidden',uncomment(text));self.assertEqual(len(text),len(code_mask(text)))

if __name__=='__main__':unittest.main(verbosity=2)
