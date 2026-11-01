"""Cached piece analysis does not eagerly parse the map's actors."""
import ast,json,tempfile,unittest
from pathlib import Path
from unittest.mock import Mock

SOURCE=Path(__file__).resolve().parents[1]/'editor/dxmaps.py'

class ReferenceAnalysis(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        root=Path(self.temp.name);self.info=root/'info.json'
        self.analyze=Mock(return_value={})
        self.ns=dict(json=json,OUT=root,ANALYSIS=42,_info_path=lambda name:self.info,
                     stamp=lambda p:dict(sha1='current'),built_current=lambda name:False,analyze=self.analyze)
        nodes=ast.parse(SOURCE.read_text(encoding='utf-8')).body
        fn=next(n for n in nodes if isinstance(n,ast.FunctionDef) and n.name=='structures')
        exec(compile(ast.Module(body=[fn],type_ignores=[]),str(SOURCE),'exec'),self.ns)

    def test_valid_analysis_does_not_read_actors(self):
        self.info.write_text(json.dumps(dict(source=dict(sha1='current'),analysis=42,structures={})))
        read=Mock(side_effect=AssertionError('Unnecessary actor parse'))
        self.assertEqual(self.ns['structures']('reference',Path(self.temp.name),read,src='map.dx'),{})
        read.assert_not_called();self.analyze.assert_not_called()

    def test_changed_source_or_analysis_reads_once(self):
        for source,version in [('old',42),('current',41)]:
            with self.subTest(source=source,version=version):
                self.info.write_text(json.dumps(dict(source=dict(sha1=source),analysis=version,structures={})))
                rows=[dict(name='Lamp0')];read=Mock(return_value=rows)
                self.ns['structures']('reference',Path(self.temp.name),read,src='map.dx')
                read.assert_called_once_with();self.assertIs(self.analyze.call_args.args[2],rows)

    def test_explicit_rows_keep_existing_contract(self):
        rows=[dict(name='Door0')]
        self.ns['structures']('reference',Path(self.temp.name),rows,src='map.dx')
        self.assertIs(self.analyze.call_args.args[2],rows)

if __name__=='__main__':unittest.main()
