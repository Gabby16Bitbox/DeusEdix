"""Contact sheet of a photo folder (shots\\<run>): python tools\\mapkit\\sheet.py <folder> [cols] [width]"""
import shutil
import subprocess
import sys
from pathlib import Path

FF = shutil.which('ffmpeg') or r'C:\Program Files (x86)\ffmpeg\bin\ffmpeg.exe'


def sheet(folder, cols=3, width=640, pattern='*.png', out_name='sheet.jpg'):
    folder = Path(folder).resolve()
    files = sorted(p for p in folder.glob(pattern) if p.name != out_name)
    lst = folder / '_list.txt'
    lst.write_text(''.join("file '%s'\n" % str(f).replace('\\', '/') for f in files), encoding='utf-8')
    rows = (len(files) + cols - 1) // cols
    out = folder / out_name
    subprocess.run([FF, '-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', str(lst), '-vf',
                    'scale=%d:-1,tile=%dx%d:padding=4:color=0x101010' % (width, cols, rows), '-frames:v', '1',
                    '-q:v', '3', str(out)], check=True)
    lst.unlink()
    return out


if __name__ == '__main__':
    a = sys.argv[1:]
    print(sheet(a[0], int(a[1]) if len(a) > 1 else 3, int(a[2]) if len(a) > 2 else 640))
