"""Example maps that come with the editor (P8 slice 4): a map script and its edits in tools/mapkit/editor/config/examples,
copied into the project's maps when asked (the Logic window's Patterns: Open the Logic Lab), never over a map of the
project. The example's own map script builds it as any map New map makes (the map opens and builds like one).

    logic_lab   25_Logic_Lab: the patterns of the library (editor/config/patterns) placed, one in each cell, on the
                objects they need (made by backup/20261110_p8/tools/make_m20_logiclab.py with the library)
"""
import shutil
from pathlib import Path

import maplinks
import newmap

HERE = Path(__file__).resolve().parent
EXAMPLES = {'logic_lab': ('new_25_logic_lab', '25_Logic_Lab')}


def folder(editor=None):
    return Path(editor or HERE) / 'config' / 'examples'


def open_example(name, maps=None, editor=None, names=None):
    """The example's map script in the project's maps, copied there the first time: {script, map, copied}. Refused when
    the project has a map of that name made otherwise, or the example's edits without its script (kept as they are)."""
    if name not in EXAMPLES:
        raise ValueError('There is no example called %r.' % name)
    script, map_name = EXAMPLES[name]
    maps = Path(maps or newmap.maps_folder())
    py, edits = maps / (script + '.py'), maps / (script + '.edits.json')
    if py.is_file():
        return dict(script=script, map=map_name, copied=False)
    if edits.exists():
        raise ValueError('The project has edits of %s without its map script: rename or move %s first.' % (map_name, edits.name))
    taken = {m.lower() for m in (names if names is not None else maplinks.all_maps())}
    if map_name.lower() in taken:
        raise ValueError('The project already has a map called %s.' % map_name)
    src = folder(editor)
    for f in (src / (script + '.py'), src / (script + '.edits.json')):
        if not f.is_file():
            raise ValueError('The example %s is missing from the editor (%s).' % (map_name, f.name))
    maps.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(src / (script + '.edits.json'), edits)       # the edits first: a script never opens without them
    shutil.copyfile(src / (script + '.py'), py)
    return dict(script=script, map=map_name, copied=True)
