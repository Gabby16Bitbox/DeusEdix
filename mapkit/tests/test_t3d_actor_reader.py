"""Actor-only reader must agree with the full T3D tree, including damaged input."""
import random
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import t3d


def tree_actors(text):
    for block in t3d.walk(t3d.blocks(text)):
        if block.kind != 'Actor' or block.tail is None or 'Class' not in block.fields or 'Name' not in block.fields:
            continue
        yield dict(cls=block.fields['Class'], name=block.fields['Name'],
                   props=dict(line.split('=', 1) for line in block.lines if '=' in line),
                   body=text[t3d._blank_lines_end(text, block.head_end):block.tail_line],
                   raw=text[block.start:t3d._blank_lines_end(text, block.end)])


class ActorReader(unittest.TestCase):
    def test_properties_raw_and_brush_children(self):
        text = ('Begin Map\r\n\tBegin Actor Class=Brush Name=Door\r\n'
                ' Tag=one\r\n Begin Brush Name=DoorModel\r\n Begin PolyList\r\n'
                ' Begin Polygon Texture=Game.Door\r\n Name=not_actor_property\r\n'
                ' End Polygon\r\n End PolyList\r\n End Brush\r\n Tag=two\r\n'
                ' Text="End Actor = Begin Actor"\r\n End Actor\r\n\r\n'
                'Begin Actor Class=Light Name=Door\r\n End Actor\r\n End Map\r\n')
        got=list(t3d.actors(text))
        self.assertEqual(got,list(tree_actors(text)))
        self.assertEqual([a['name'] for a in got],['Door','Door'])
        self.assertEqual(got[0]['props'],{'Tag':'two','Text':'"End Actor = Begin Actor"'})

    def test_nested_actors_preorder_even_when_outer_is_unclosed(self):
        texts = ['Begin Actor Class=A Name=Outer\nBegin Actor Class=B Name=Inner\nEnd Actor\n',
                 'Begin Actor Class=A Name=Outer\nBegin Actor Class=B Name=Inner\nEnd Actor\nEnd Actor\n',
                 'Begin Map\nBegin Actor Class=A Name=Unclosed\nEnd Map\n',
                 'Begin Actor Class=A\nBegin Actor Class=B Name=Inner\nEnd Actor\nEnd Actor\n']
        for text in texts:
            with self.subTest(text=text): self.assertEqual(list(t3d.actors(text)),list(tree_actors(text)))

    def test_generated_malformed_blocks_and_whitespace(self):
        rng=random.Random(739)
        lines=['Begin Map','End Map','Begin Actor Class=A Name=One','Begin Actor Class=B Name=Two',
               'Begin Actor Class=A','Begin Actor Name=MissingClass','Begin Brush Name=Model0',
               'End Brush','End Actor','Begin PolyList','End PolyList','Begin Polygon Texture=T',
               'End Polygon','End Unknown','Tag=one','Tag=two','Text="a=b"','Vertex +0,+1,+2','']
        for case in range(2500):
            newline=rng.choice(['\n','\r\n'])
            text=newline.join(rng.choice(['',' ','\t','\u2003'])+rng.choice(lines)+rng.choice(['',' ','\t'])
                              for _ in range(rng.randrange(0,70)))+rng.choice(['',newline,newline*2])
            with self.subTest(case=case): self.assertEqual(list(t3d.actors(text)),list(tree_actors(text)))

    def test_results_are_independent(self):
        text='Begin Actor Class=Light Name=Light0\nTag=Lamp\nEnd Actor\n'
        first=list(t3d.actors(text));first[0]['props']['Tag']='changed'
        self.assertEqual(list(t3d.actors(text))[0]['props']['Tag'],'Lamp')


if __name__=='__main__':unittest.main()
