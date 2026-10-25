"""Exercise the real staged HTTP handler: analysis must bypass runtime/build writes."""
import ast
import contextlib
import io
import json
import mimetypes
import re
import threading
import traceback
import types
import unittest
from email.message import Message
from http.server import BaseHTTPRequestHandler
from pathlib import Path
from unittest.mock import Mock
from urllib.parse import parse_qs, urlparse
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'editor'))
import local_guard  # noqa: E402  (the real one: these requests carry the editor's own address)

HERE=Path(__file__).resolve().parent
SOURCE=HERE/'staged/editor/server.py'
if not SOURCE.exists():SOURCE=HERE.parent/'editor/server.py'

class RouteTests(unittest.TestCase):
    def setUp(self):
        self.start=Mock(return_value={'state':'running'})
        self.ensure=Mock(side_effect=AssertionError('Read-only analysis tried to prepare the runtime'))
        self.project=types.SimpleNamespace(WORKER=True,authorized=lambda h: h.get('X-DeusEdix-Session')=='good',operation=contextlib.nullcontext,ensure_runtime=self.ensure,error_payload=lambda e:{'error':str(e)})
        self.graph=types.SimpleNamespace(status=lambda:{'state':'idle'},start=self.start)
        namespace=dict(BaseHTTPRequestHandler=BaseHTTPRequestHandler,json=json,urlparse=urlparse,parse_qs=parse_qs,
                       re=re,mimetypes=mimetypes,threading=threading,traceback=traceback,LOCK=threading.RLock(),
                       project_server=self.project,mission_graph=self.graph,local_guard=local_guard)
        tree=ast.parse(SOURCE.read_text(encoding='utf-8-sig'))
        node=next(n for n in tree.body if isinstance(n,ast.ClassDef) and n.name=='Handler')
        exec(compile(ast.Module(body=[node],type_ignores=[]),str(SOURCE),'exec'),namespace)
        self.handler=namespace['Handler']
    def request(self,path,body=None,method='POST',auth=True,length=None):
        h=object.__new__(self.handler);h.path=path;raw=json.dumps(body if body is not None else {}).encode()
        h.headers=Message();h.headers['Content-Length']=str(len(raw) if length is None else length)
        h.headers['Host']='127.0.0.1:8790';h.server=types.SimpleNamespace(server_port=8790)   # the editor's own address
        if auth:h.headers['X-DeusEdix-Session']='good'
        h.rfile=io.BytesIO(raw);output=[];h._send=lambda status,payload,*args:output.append((status,payload))
        getattr(h,'do_'+method)();self.assertEqual(len(output),1);self.ensure.assert_not_called();return output[0]
    def test_status_never_prepares_runtime(self):self.assertEqual(self.request('/api/missiongraph',method='GET'),(200,{'state':'idle'}))
    def test_scan_starts_only_reader(self):
        self.assertEqual(self.request('/api/missiongraph/scan',{'readSources':False})[0],200);self.assertFalse(self.start.call_args.args[0])
    def test_source_export_is_explicit(self):
        self.request('/api/missiongraph/scan',{'readSources':True});self.assertTrue(self.start.call_args.args[0])
    def test_rejects_edit_payloads_and_invalid_types(self):
        for value in [{'path':'C:/secret'},{'readSources':'yes'},[],{'map':'anything'}]:self.assertEqual(self.request('/api/missiongraph/scan',value)[0],400)
        self.start.assert_not_called()
    def test_rejects_oversized_payload(self):self.assertEqual(self.request('/api/missiongraph/scan',length=1000)[0],400);self.start.assert_not_called()
    def test_authorization_required(self):
        self.assertEqual(self.request('/api/missiongraph',method='GET',auth=False)[0],409);self.assertEqual(self.request('/api/missiongraph/scan',auth=False)[0],409);self.start.assert_not_called()
    def test_project_context_required(self):
        self.project.WORKER=False;self.assertEqual(self.request('/api/missiongraph/scan')[0],409);self.start.assert_not_called()

if __name__=='__main__':unittest.main(verbosity=2)
