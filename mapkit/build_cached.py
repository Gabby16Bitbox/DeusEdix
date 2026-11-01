"""Run a generated-map script with caches scoped to this single build."""
from pathlib import Path
import runpy
import sys
import build_cache


def main():
    if len(sys.argv) < 2:
        raise SystemExit('Usage: build_cached.py map-script.py [script arguments]')
    script = Path(sys.argv[1]).resolve()
    if not script.is_file() or script.suffix.lower() != '.py':
        raise SystemExit('Map script was not found')
    import build_cpu
    build_cpu.prefer_performance()
    sys.argv = [str(script)] + sys.argv[2:]
    sys.path[0] = str(script.parent)
    with build_cache.scope():
        runpy.run_path(str(script), run_name='__main__')


if __name__ == '__main__':
    main()
