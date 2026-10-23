"""Export every original campaign map of Revision to tools/mapkit/refs/<map>.t3d (cached).

    python tools/mapkit/export_all.py          # then: python tools/mapkit/texusage.py

Used to learn how the game itself uses each texture (texusage.py) and its real sizes (refdims.py).
"""
import re
import shutil
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import refscan  # noqa: E402

if __name__ == '__main__':
    maps = sorted(p.stem for p in refscan.REV_MAPS.glob('*.dx') if re.match(r'^\d\d_', p.stem))
    t0 = time.time()
    for i, m in enumerate(maps):
        import polys
        if polys.ref_path(m) is not None:
            continue
        try:
            refscan.export(m)
            print('%3d/%d %s ok (%.0fs)' % (i + 1, len(maps), m, time.time() - t0), flush=True)
        except Exception as e:  # a map the SDK cannot load is skipped
            print('%3d/%d %s FAILED %s' % (i + 1, len(maps), m, str(e)[:120]), flush=True)
        # the private run folders are only needed for the export
        for d in (HERE / 'runs').glob('*-ref-%s-*' % m):
            shutil.rmtree(d, ignore_errors=True)
    print('done', len(maps), 'maps in %.0fs' % (time.time() - t0))
