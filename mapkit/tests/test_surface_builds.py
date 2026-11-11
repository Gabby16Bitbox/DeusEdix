"""Surface edits through both build pipelines; the generated source map stays untouched."""
import hashlib
import json
import sys
import tempfile
from pathlib import Path
from PIL import Image, ImageDraw

from test_surfaces import KIT, polygons, close
import dxmaps
import geom
import kit
from scene import Scene


def scene():
    s = Scene('SurfacePipeline', packages=[])
    s.texture(root / 'pattern.pcx', 'SurfacePattern')
    s.auto_groups = False
    s.sub(geom.box((-512, -512, -128), (512, 512, 384), 'SurfacePattern'))
    s.add(geom.prism((0, 0), 96, -128, 128, 'SurfacePattern', sides=8, ry=64))
    s.light((0, -250, 240), brightness=150, radius=24)
    return s


def dump(path):
    run = kit.new_run([path], 'surface-pipeline-read')
    kit.execute(run, ['MAP LOAD FILE="..\\Input\\%s"' % path.name,
                      r'UC_BSPDUMP ..\Output\bsp.bin'])
    return polygons(run / 'Output' / 'bsp.bin')


with tempfile.TemporaryDirectory(prefix='surface-pipeline-', dir=Path(__file__).parent) as temp:
    root = Path(temp)
    pattern = Image.new('RGB', (128, 64), '#788897')
    paint = ImageDraw.Draw(pattern)
    for x in range(0, 128, 16):
        for y in range(0, 64, 16):
            if (x + y) % 32 == 0:
                paint.rectangle((x, y, x + 15, y + 15), fill='#d6b35b')
    pattern.convert('P').save(root / 'pattern.pcx')
    source = root / 'SurfacePipeline.dx'
    _, built = scene().build(source, paths=False)
    before = dump(source)
    sha = hashlib.sha256(source.read_bytes()).hexdigest()
    edits = {'surfaces': [dict(op='pan', args=[16, -8], targets=[dict(brush='Brush3', poly=1)]),
                           dict(op='shadows', args=['high'], targets=[dict(brush='Brush3', poly='*')])]}
    editfile = root / 'edits.json'
    editfile.write_text(json.dumps(edits))
    # Script builds must override light=False after changing UVs.
    folder, scripted = scene().build(root / 'scripted.dx', paths=False, light=False, edits=editfile)
    log = (folder / 'build.log').read_text(errors='replace')
    assert 'LIGHT APPLY' in log
    result = dump(scripted)
    assert close(result[(1, 1)][0]['uv'][9:11], [16, -8])
    assert all(p['flags'] & 0x808000 == 0x800000 for (b, _), ps in result.items() if b == 1 for p in ps)
    print('PASS script build: forced lighting and whole-brush shadows', flush=True)
    # Keep the existing-map builder confined to the generated fixture and a temporary output.
    dxmaps.MOD_MAPS = root
    dxmaps.OUT = root / 'out'
    dxmaps.OUT.mkdir()
    dxmaps.edits_path = lambda _: editfile
    for iteration in range(2):
        ok, lines = dxmaps.build('SurfacePipeline')
        assert ok, lines
        info = json.loads(dxmaps._info_path('SurfacePipeline').read_text())['built']
        assert info['lights'] and not info['geometry'] and not info['paths'], info
        result = dump(dxmaps.OUT / 'SurfacePipeline.dx')
        assert close(result[(1, 1)][0]['uv'][9:11], [16, -8]), 'Relative edits were applied twice'
        assert hashlib.sha256(source.read_bytes()).hexdigest() == sha, 'Source map changed'
        assert any('lightmap samples' in line for line in lines)
    print('PASS existing-map build: no BSP/path rebuild, repeatable edits, original hash unchanged', flush=True)
    # Non-uniformly scaled, rotated and translated source brush: mapping must survive rebuild too.
    run = kit.new_run([source], 'surface-transform')
    cmds = [r'MAP LOAD FILE="..\Input\SurfacePipeline.dx"', 'UC_SET Brush3 50 40 0 0 8192 0',
            'UC_PROP Brush3 MainScale (Scale=(X=1.5,Y=0.75,Z=1.1),SheerAxis=SHEER_None)',
            'MAP REBUILD', 'BSP REBUILD OPTIMAL BALANCE=15', 'UC_WORLD finish',
            'UC_SURFACE Brush3 1 tile', r'UC_BSPDUMP ..\Output\before.bin',
            'MAP REBUILD', 'BSP REBUILD OPTIMAL BALANCE=15', 'UC_WORLD finish',
            r'UC_BSPDUMP ..\Output\after.bin']
    kit.execute(run, cmds)
    a, b = [polygons(run / 'Output' / (n + '.bin')) for n in ('before', 'after')]
    assert close(a[(1, 1)][0]['uv'], b[(1, 1)][0]['uv']), 'Transform lost mapping'
    assert close(a[(1, 1)][0]['verts'], b[(1, 1)][0]['verts']), 'Mapping changed geometry'
    print('PASS transformed brush: mapping and geometry survive BSP rebuild', flush=True)
