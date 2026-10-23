"""Regression tests: isolated data only; importing production services never writes projects."""
import copy,json,sys,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
HERE=Path(__file__).resolve().parent
KIT=HERE.parent
sys.path[:0]=[str(KIT/'editor'),str(KIT)]
import player_profiles as profiles
import statecatalog

class PlayerProfilesTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix='profiles-')
        self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name)
        (self.root/'characters').mkdir(); (self.root/'maps').mkdir()
        for name,value in [('KIT',self.root),('FILE',self.root/'players.json')]:
            p=patch.object(profiles,name,value);p.start();self.addCleanup(p.stop)
        p=patch.object(profiles.settings,'PROJECT_KIND','custom',create=True);p.start();self.addCleanup(p.stop)
        self.character={'id':'hero-a','name':'Hero A','body':'GM_Trench',
                        'skins':['DeusExCharacters.JCDentonTex0']*8,
                        'health':999,'inventory':[{'cls':'WeaponPistol'}],'bindname':'BadName','behaviour':'soldier'}
        self.write('characters/hero-a.json',self.character)

    def write(self,name,value):
        (self.root/name).write_text(json.dumps(value),encoding='utf8')

    def config(self,default='hero-a'):
        return profiles.save({'version':1,'default':default,'state':'shared'},profiles.catalog()['revision'])

    def test_existing_maps_unchanged(self):
        self.assertEqual(profiles.blocks({}),[])
        self.assertIsNone(profiles.build_dependency({}))
        self.assertEqual(profiles.blocks({'level':{'info':{'MapAuthor':'X'}}}),[])

    def test_project_default_and_per_map_override(self):
        self.config()
        block=profiles.blocks({})[0]
        self.assertEqual(block['props']['ProfileID'],'"hero-a"')
        self.assertEqual(profiles.blocks({'level':{'player':'jc'}})[0]['props']['bUseOriginal'],'True')
        self.assertEqual(profiles.read()['default'],'hero-a')

    def test_override_works_without_project_file(self):
        self.assertEqual(profiles.blocks({'level':{'player':'hero-a'}})[0]['props']['ProfileFlag'],'UCEdPlayer_hero_a')
        self.assertFalse(profiles.FILE.exists())

    def test_only_appearance_copied_no_story_or_ai_changes(self):
        props=profiles.appearance('hero-a')['props']
        for key in ('BindName','Health','Inventory','Alliance','Orders','CollisionHeight','CollisionRadius'):
            self.assertNotIn(key,props)
        self.assertEqual(props['Mesh'],"LodMesh'DeusExCharacters.GM_Trench'")
        self.assertEqual(len([key for key in props if key.startswith('MultiSkins')]),8)

    def test_unsafe_ids_assets_and_unsupported_bodies_rejected(self):
        for cid in ('../x','jc\nX','../hero-a','Hero-a','bad_name',''):
            with self.subTest(cid=cid),self.assertRaises(ValueError): profiles.appearance(cid)
        for field,value in [('id','other'),('body','GM_Suit_F'),('body',"Foo'Injected"),('skins',['bad']*8),('skins',[])]:
            ch={**self.character,field:value};self.write('characters/hero-a.json',ch)
            with self.subTest(field=field,value=value),self.assertRaises(ValueError):profiles.appearance('hero-a')

    def test_optimistic_conflict_does_not_overwrite(self):
        revision=profiles.catalog()['revision'];self.config()
        before=profiles.FILE.read_bytes()
        with self.assertRaisesRegex(ValueError,'another window'):
            profiles.save({'version':1,'default':'jc'},revision)
        self.assertEqual(before,profiles.FILE.read_bytes())

    def test_missing_character_blocks_build_instead_of_silent_jc(self):
        with self.assertRaisesRegex(ValueError,'missing'):
            profiles.blocks({'level':{'player':'missing'}})

    def test_tutorial_does_not_persist_project_default(self):
        with patch.object(profiles.settings,'PROJECT_KIND','tutorial'):
            self.assertTrue(profiles.catalog()['temporary'])
            with self.assertRaisesRegex(ValueError,'temporary'):self.config()
        self.assertFalse(profiles.FILE.exists())

    def test_separate_progress_never_claimed_available(self):
        with self.assertRaisesRegex(ValueError,'not available'):
            profiles.save({'version':1,'default':'jc','state':'independent'},profiles.catalog()['revision'])
        self.assertFalse(profiles.FILE.exists())

    def test_deletion_reference_guard(self):
        self.config();self.write('maps/A.edits.json',{'level':{'player':'hero-a'}})
        self.assertEqual(set(profiles.references('hero-a')),{'the project default','A'})
        self.assertEqual(profiles.references('unreferenced'),[])

    def test_automatic_story_condition_is_project_local(self):
        self.config()
        flags=statecatalog.catalog(kit=self.root)['flags']
        hero=next(x for x in flags if x['flag']=='UCEdPlayer_hero_a')
        self.assertEqual(hero['label'],'Player is Hero A');self.assertEqual(hero['source'],'automatic')
        self.assertEqual(len(flags),2)

    def test_bad_reference_file_prevents_delete(self):
        (self.root/'maps/A.edits.json').write_text('{')
        with self.assertRaisesRegex(ValueError,'Cannot check'):profiles.references('hero-a')

    def test_build_dependency_tracks_default_and_appearance_not_npc_logic(self):
        self.config()
        first=profiles.build_dependency({})
        self.character['health']=100
        self.write('characters/hero-a.json',self.character)
        self.assertEqual(first,profiles.build_dependency({}))
        self.character['skins'][0]='DeusExCharacters.JCDentonTex1'
        self.write('characters/hero-a.json',self.character)
        self.assertNotEqual(first,profiles.build_dependency({}))
        override=profiles.build_dependency({'level':{'player':'hero-a'}})
        self.config('jc')
        self.assertNotEqual(first,profiles.build_dependency({}))
        self.assertEqual(override,profiles.build_dependency({'level':{'player':'hero-a'}}))

if __name__=='__main__':unittest.main(verbosity=2)
