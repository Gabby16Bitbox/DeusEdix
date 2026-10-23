"""Experimental local geometry: an isolated, non-publishing editor tool."""
from pathlib import Path
import argparse
import json
import os
import re
import threading
import webview
import local_geometry as core
import worker_bridge

class Api:
    def __init__(self,handoff=None):
        self._window=None;self._audit=None;self._output=None;self._receipt=None;self._lock=threading.Lock()
        self._handoff=handoff;self._context={}

    def _inspect(self,path):
        self._audit=None;self._output=None;self._receipt=None
        self._audit=core.inspect(path);return self._audit

    def startup(self):
        with self._lock:
            if not self._handoff:return None
            path=Path(self._handoff).resolve();base=(core.ROOT/'handoffs').resolve()
            if path.name!='handoff.json' or path.parent.parent!=base or not re.fullmatch('[0-9a-f]{32}',path.parent.name):
                raise core.Refused('Invalid experimental workspace.')
            data=json.loads(path.read_text(encoding='utf-8'))
            source=Path(data['source']).resolve()
            if data.get('version')!=1 or source!=path.parent/'source.dx' or core.base.sha(source)!=data.get('sha256'):
                raise core.Refused('The private map copy changed. Open the tool again.')
            self._context=data.get('context_sha256',{})
            worker_bridge.unchanged(self._context)
            result=self._inspect(source)
            if result['sha256']!=data['sha256']:raise core.Refused('The private map copy changed during inspection.')
            worker_bridge.unchanged(self._context)
            result['selected_brush']=data.get('brush')
            result['label']=data.get('label','Private map copy')
            return result

    def open_map(self):
        with self._lock:
            value=self._window.create_file_dialog(webview.FileDialog.OPEN,allow_multiple=False,file_types=('Deus Ex maps (*.dx)',))
            if not value:return None
            self._context={}
            return self._inspect(Path(value[0]))

    def rebuild(self,name,move,scale,rotation,build_mode='full'):
        with self._lock:
            if not self._audit:raise core.Refused('Open a map first.')
            if build_mode=='certified_box':
                if any(rotation) or bool(any(move))==bool(any(v!=1 for v in scale)):
                    raise core.Refused('Isolated boxes support either a translation or an axial resize, without rotation.')
                change=dict(move=move) if any(move) else dict(scale=scale)
            elif build_mode in ('full','certified_convex','certified_detail'):change=dict(move=move,scale=scale,rotation=rotation)
            else:raise core.Refused('Unknown rebuild mode.')
            worker_bridge.unchanged(self._context)
            receipt=worker_bridge.run(self._audit['source'],self._audit['sha256'],{name:change},context_paths=self._context,validation=build_mode)
            worker_bridge.unchanged(self._context)
            result=worker_bridge.read(Path(receipt['bundle'])/'evidence.json')
            bundle=Path(receipt['bundle'])
            result['polygons']=core.preview(core.base.tree(bundle/'preview.tree'))
            worker_bridge.accept(bundle.parent,receipt['request_sha256'])
            self._receipt=receipt;self._output=bundle/'map.dx'
            result['output']=str(self._output)
            return result

    def continue_result(self):
        with self._lock:
            worker_bridge.unchanged(self._context)
            if not self._output:raise core.Refused('Create a verified result first.')
            receipt=self._receipt;output=self._output
            worker_bridge.accept(Path(receipt['bundle']).parent,receipt['request_sha256'])
            audit=self._inspect(output)
            if audit['sha256']!=receipt['files']['map.dx']:
                self._audit=None
                raise core.Refused('Verified result changed before inspection.')
            return audit

    def show_result(self):
        if self._output:
            worker_bridge.accept(Path(self._receipt['bundle']).parent,self._receipt['request_sha256'])
            os.startfile(str(self._output.parent))

    def _closing(self):return not self._lock.locked()

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--handoff');args=parser.parse_args()
    api=Api(args.handoff);api._window=webview.create_window('DeusEdix — Local geometry (Experimental)',
        html=(core.ROOT/'ui.html').read_text(encoding='utf-8'),js_api=api,width=1160,height=780,min_size=(920,660),background_color='#18212b')
    api._window.events.closing+=api._closing
    webview.start(gui='edgechromium')

if __name__=='__main__':main()
