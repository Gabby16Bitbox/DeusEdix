"""The AI assistant's way into the editor: the user's switch (agent_bridge.set_allowed), calls held for the page
(agent_bridge.Calls) and the MCP server's protocol and tools (deusedix_mcp.py)."""
import io
import json
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest import mock

KIT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(KIT), str(KIT / 'editor')]
import agent_bridge  # noqa: E402
import deusedix_mcp  # noqa: E402


class Switch(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        patcher = mock.patch.object(agent_bridge, 'FILE', Path(self.tmp.name) / 'DeusEdix' / 'assistant.json')
        patcher.start()
        self.addCleanup(patcher.stop)
        self.addCleanup(self.tmp.cleanup)

    def test_off_until_the_user_allows_it(self):
        self.assertFalse(agent_bridge.allowed())
        agent_bridge.register('http://127.0.0.1:1/', 'token', 'C:/DeusEdix')
        self.assertFalse(agent_bridge.FILE.exists())         # starting a hub writes nothing while it is off
        self.assertEqual(agent_bridge.editors(), {})

    def test_allowed_hubs_are_found_and_forgotten_when_switched_off(self):
        agent_bridge.set_allowed(True, 'http://127.0.0.1:1/', 'a', 'C:/One')
        agent_bridge.register('http://127.0.0.1:2/', 'b', 'C:/Two')
        self.assertEqual(sorted(agent_bridge.editors()), ['C:/One', 'C:/Two'])
        agent_bridge.unregister('C:/Two')
        self.assertEqual(list(agent_bridge.editors()), ['C:/One'])
        agent_bridge.set_allowed(False, 'http://127.0.0.1:1/', 'a', 'C:/One')
        self.assertFalse(agent_bridge.allowed())
        self.assertNotIn('"a"', agent_bridge.FILE.read_text(encoding='utf-8'))    # no session left on disk

    def test_a_broken_file_is_off(self):
        agent_bridge.FILE.parent.mkdir(parents=True)
        agent_bridge.FILE.write_text('[1, 2', encoding='utf-8')
        self.assertFalse(agent_bridge.allowed())


class ShownCommand(unittest.TestCase):
    ENV = {'LOCALAPPDATA': 'C:\\Users\\someone\\AppData\\Local', 'APPDATA': 'C:\\Users\\someone\\AppData\\Roaming',
           'USERPROFILE': 'C:\\Users\\someone\\'}

    def test_the_users_folders_are_written_as_their_variables(self):
        parts = ['C:\\Users\\someone\\AppData\\Local\\Programs\\DeusEdix\\deusedix-cli.exe', '--run',
                 'c:\\users\\SOMEONE\\Documents\\DeusEdix\\x.py', 'D:\\Games\\y.py']
        self.assertEqual(agent_bridge.shown(parts, self.ENV), [
            '%LOCALAPPDATA%\\Programs\\DeusEdix\\deusedix-cli.exe', '--run',
            '%USERPROFILE%\\Documents\\DeusEdix\\x.py', 'D:\\Games\\y.py'])

    def test_a_folder_that_only_starts_the_same_is_left_alone(self):
        self.assertEqual(agent_bridge.shown(['C:\\Users\\someone2\\a.py'], self.ENV), ['C:\\Users\\someone2\\a.py'])
        self.assertEqual(agent_bridge.shown(['C:\\x.py'], {}), ['C:\\x.py'])


class Clock:
    def __init__(self):
        self.now = 1000.0

    def __call__(self):
        return self.now


class HeldCalls(unittest.TestCase):
    def test_no_page_no_wait(self):
        calls = agent_bridge.Calls(Clock())
        with self.assertRaises(agent_bridge.PageClosed):
            calls.call('state', {}, 5)

    def test_unknown_operations_are_refused_before_waiting(self):
        with self.assertRaises(ValueError):
            agent_bridge.Calls(Clock()).call('format_disk', {}, 5)

    def test_the_page_takes_the_call_and_answers_it(self):
        calls, answers = agent_bridge.Calls(), []
        page_waiting = threading.Event()

        def page():
            page_waiting.set()
            job = calls.next(wait=5)
            calls.result(job['id'], True, dict(op=job['op'], args=job['args']))

        worker = threading.Thread(target=page)
        worker.start()
        page_waiting.wait(5)
        while not calls.page_open():
            pass
        answers.append(calls.call('find', {'text': 'door'}, 5))
        worker.join(5)
        self.assertEqual(answers, [dict(ok=True, value=dict(op='find', args={'text': 'door'}))])

    def test_an_error_of_the_page_comes_back_as_its_text(self):
        calls = agent_bridge.Calls()
        threading.Thread(target=lambda: (lambda job: calls.result(job['id'], False, error='No map is open'))(calls.next(5))).start()
        while not calls.page_open():
            pass
        self.assertEqual(calls.call('state', {}, 5), dict(ok=False, error='No map is open'))

    def test_a_call_nobody_finishes_times_out_and_a_late_answer_is_dropped(self):
        clock = Clock()
        calls = agent_bridge.Calls(clock)
        calls._asked = clock.now                 # a page asked a moment ago
        with self.assertRaises(TimeoutError):
            calls.call('rebuild', {}, 0.05)
        self.assertIsNone(calls.next(wait=0))    # the timed-out call is not run later
        self.assertFalse(calls.result('nobody', True, 1))

    def test_a_page_that_stopped_asking_is_closed(self):
        clock = Clock()
        calls = agent_bridge.Calls(clock)
        calls.next(wait=0)
        self.assertTrue(calls.page_open())
        clock.now += agent_bridge.PAGE_GONE + 1
        self.assertFalse(calls.page_open())


def asking(calls, n):
    """Wait until n pages are waiting in calls.next()."""
    end = time.monotonic() + 5
    while calls._asking < n and time.monotonic() < end:
        time.sleep(0.005)
    return calls._asking >= n


class ReloadedPage(unittest.TestCase):
    """A reload leaves the old page's long poll waiting on the server (its socket is gone, nobody reads it): the next
    call must go to the new page at once, not to that poll (8 Nov: open_map waited 300 s)."""

    def test_two_pages_ask_and_the_older_one_is_gone(self):
        calls, old = agent_bridge.Calls(), []
        dead = threading.Thread(target=lambda: old.append(calls.next(wait=10, page='old')))
        dead.start()
        self.assertTrue(asking(calls, 1))

        def new_page():                          # the reloaded page: asks again after each answer, like agent.js
            for _ in range(2):
                job = calls.next(wait=5, page='new')
                if job and job.get('id'):
                    calls.result(job['id'], True, job['op'])
        live = threading.Thread(target=new_page)
        live.start()
        dead.join(2)
        self.assertFalse(dead.is_alive())        # the old poll left at once...
        self.assertEqual(old, [dict(superseded=True)])    # ...without a call
        start = time.monotonic()
        self.assertEqual(calls.call('state', {}, 5), dict(ok=True, value='state'))
        self.assertLess(time.monotonic() - start, 1)
        self.assertEqual(calls.call('maps', {}, 5), dict(ok=True, value='maps'))
        live.join(5)

    def test_a_poll_whose_connection_closed_never_takes_a_call(self):
        calls, got = agent_bridge.Calls(), []
        dead = threading.Thread(target=lambda: got.append(calls.next(wait=10, gone=lambda: True)))
        dead.start()
        self.assertTrue(asking(calls, 1))
        answer = []
        caller = threading.Thread(target=lambda: answer.append(calls.call('state', {}, 5)))
        caller.start()
        dead.join(2)
        self.assertEqual(got, [None])
        job = calls.next(wait=2, gone=lambda: False)          # a live page still finds it waiting
        self.assertEqual(job['op'], 'state')
        calls.result(job['id'], True, 1)
        caller.join(5)
        self.assertEqual(answer, [dict(ok=True, value=1)])

    def test_a_closed_newest_tab_leaves_the_calls_to_the_older_one_at_once(self):
        calls, got = agent_bridge.Calls(), []
        self.assertIsNone(calls.next(wait=0, page='older'))
        closed = threading.Thread(target=lambda: got.append(calls.next(wait=10, page='newer', gone=lambda: True)))
        closed.start()
        self.assertTrue(asking(calls, 1))
        self.assertEqual(calls.next(wait=0, page='older'), dict(superseded=True))    # newer still looks open
        answer = []
        caller = threading.Thread(target=lambda: answer.append(calls.call('state', {}, 5)))
        caller.start()
        closed.join(2)
        self.assertEqual(got, [None])                          # its connection is closed: no call for it
        job = calls.next(wait=2, page='older', gone=lambda: False)
        self.assertEqual(job['op'], 'state')                   # not set aside for PAGE_GONE seconds
        calls.result(job['id'], True, 2)
        caller.join(5)
        self.assertEqual(answer, [dict(ok=True, value=2)])

    def test_an_older_tab_takes_over_when_the_newer_one_is_gone(self):
        clock = Clock()
        calls = agent_bridge.Calls(clock)
        self.assertIsNone(calls.next(wait=0, page='a'))
        self.assertIsNone(calls.next(wait=0, page='b'))
        self.assertEqual(calls.next(wait=0, page='a'), dict(superseded=True))
        self.assertIsNone(calls.next(wait=0))                 # a page that gives no id is never set aside
        clock.now += agent_bridge.PAGE_GONE + 1                # tab b was closed
        self.assertIsNone(calls.next(wait=0, page='a'))
        self.assertTrue(calls.page_open())
        clock.now += agent_bridge.PAGE_GONE + 1                # a went quiet too (a background tab slowed down)
        self.assertIsNone(calls.next(wait=0, page='b'))
        self.assertEqual(calls.next(wait=0, page='a'), dict(superseded=True))   # back, a is still the older load
        for n in range(agent_bridge.MAX_PAGES + 4):             # many reloads: only the latest loads are remembered
            calls.next(wait=0, page='r%d' % n)
        self.assertLessEqual(len(calls._pages), agent_bridge.MAX_PAGES)

    def test_a_page_running_a_long_call_keeps_the_calls(self):
        clock = Clock()
        calls = agent_bridge.Calls(clock)
        calls.next(wait=0, page='a')
        calls.next(wait=0, page='b')
        calls._waiting.append(dict(id='j', op='rebuild', args={}, done=threading.Event(), result=None, page=None))
        self.assertEqual(calls.next(wait=0, page='b')['id'], 'j')
        clock.now += 120                                        # a rebuild of two minutes; tab a asks meanwhile
        self.assertEqual(calls.next(wait=0, page='a'), dict(superseded=True))
        self.assertTrue(calls.result('j', True))

    def test_a_call_that_could_not_be_sent_is_given_back(self):
        calls, answer = agent_bridge.Calls(), []
        calls._asked = time.monotonic()
        caller = threading.Thread(target=lambda: answer.append(calls.call('find', {}, 5)))
        caller.start()
        first = calls.next(wait=2, page='p')
        self.assertTrue(calls.give_back(first['id']))         # the response write failed
        again = calls.next(wait=2, page='p')
        self.assertEqual(again['id'], first['id'])
        self.assertTrue(calls.result(again['id'], True, 'found'))
        self.assertFalse(calls.give_back(again['id']))        # answered: nothing to give back
        caller.join(5)
        self.assertEqual(answer, [dict(ok=True, value='found')])


class FakeEditor:
    def __init__(self, answer):
        self.answer, self.calls = answer, []

    def call(self, op, args, timeout):
        self.calls.append((op, args, timeout))
        return self.answer

    def api(self, path, body=None):
        return dict(path=path, body=body)


class McpServer(unittest.TestCase):
    def rpc(self, editor, *messages):
        out = io.BytesIO()
        deusedix_mcp.main(io.BytesIO(b''.join(json.dumps(m).encode() + b'\n' for m in messages)), out)
        return [json.loads(line) for line in out.getvalue().splitlines()]

    def test_initialize_and_list(self):
        answers = self.rpc(None, dict(jsonrpc='2.0', id=1, method='initialize', params=dict(protocolVersion='2025-06-18')),
                           dict(jsonrpc='2.0', method='notifications/initialized'),
                           dict(jsonrpc='2.0', id=2, method='tools/list'), dict(jsonrpc='2.0', id=3, method='nope'))
        self.assertEqual([a['id'] for a in answers], [1, 2, 3])        # the notification has no answer
        self.assertEqual(answers[0]['result']['protocolVersion'], '2025-06-18')
        self.assertIn('tools', answers[0]['result']['capabilities'])
        tools = {t['name']: t for t in answers[1]['result']['tools']}
        self.assertIn('view', tools)
        for t in tools.values():
            self.assertEqual(t['inputSchema']['type'], 'object')
            self.assertTrue(set(t['inputSchema']['required']) <= set(t['inputSchema']['properties']), t['name'])
        self.assertEqual(answers[2]['error']['code'], -32601)

    def test_an_unknown_protocol_version_gets_the_newest(self):
        answer = deusedix_mcp.handle(None, dict(id=1, method='initialize', params=dict(protocolVersion='1999-01-01')))
        self.assertEqual(answer['result']['protocolVersion'], deusedix_mcp.PROTOCOLS[0])

    def test_every_tool_is_an_operation_the_server_lets_through(self):
        ops = {t[0] for t in deusedix_mcp.TOOLS.values() if t[0]}
        self.assertEqual(ops, set(agent_bridge.OPS))

    def test_a_call_runs_its_operation(self):
        editor = FakeEditor(dict(ok=True, value=dict(count=1)))
        content, error = deusedix_mcp.call_tool(editor, 'find_objects', {'text': 'door'})
        self.assertFalse(error)
        self.assertEqual(json.loads(content[0]['text']), dict(count=1))
        self.assertEqual(editor.calls, [('find', {'text': 'door'}, deusedix_mcp.TOOLS['find_objects'][1])])

    def test_a_picture_is_an_image(self):
        editor = FakeEditor(dict(ok=True, value=dict(image='data:image/jpeg;base64,/9j/4AAQ', camera=[0, 0, 0])))
        content, error = deusedix_mcp.call_tool(editor, 'view', {})
        self.assertFalse(error)
        self.assertEqual(content[0], dict(type='image', data='/9j/4AAQ', mimeType='image/jpeg'))
        self.assertEqual(json.loads(content[1]['text']), dict(camera=[0, 0, 0]))

    def test_picture_placement_uses_its_own_operation(self):
        args = dict(tex='Art_D', at=[0, 0, 80], width=128, face='+y', exact=True)
        editor = FakeEditor(dict(ok=True, value=dict(name='UCEditBox1')))
        content, error = deusedix_mcp.call_tool(editor, 'place_picture', args)
        self.assertFalse(error)
        self.assertEqual(json.loads(content[0]['text'])['name'], 'UCEditBox1')
        self.assertEqual(editor.calls, [('picture', args, deusedix_mcp.TOOLS['place_picture'][1])])
        self.assertIn('picture', agent_bridge.OPS)
        self.assertEqual(deusedix_mcp.TOOL_KINDS['place_picture'], 'edit')

    def test_the_logic_tools(self):
        # P3 logic_propose: read, offer, check, try and the proposal's outcome only read; a proposal changes nothing
        # until the user accepts it in the editor (an edit, never destructive)
        # (P2 Why didn't it run?: logic_why and logic_log only read too)
        for name in ('logic_read', 'logic_offer', 'logic_check', 'logic_try', 'logic_proposal', 'logic_why', 'logic_log'):
            self.assertEqual(deusedix_mcp.TOOL_KINDS[name], 'read', name)
            self.assertIn(deusedix_mcp.TOOLS[name][0], agent_bridge.OPS)
        self.assertEqual(deusedix_mcp.TOOL_KINDS['logic_propose'], 'edit')
        # P8 slice 7: the patterns listed, or one placed now (an undoable edit, like place_object)
        self.assertEqual(deusedix_mcp.TOOL_KINDS['logic_patterns'], 'edit')
        self.assertIn('logic_patterns', agent_bridge.OPS)
        self.assertIn('place_pattern', deusedix_mcp.TOOLS['logic_propose'][2])
        self.assertIn('make_box', deusedix_mcp.TOOLS['logic_propose'][2])
        self.assertEqual(deusedix_mcp.TOOLS['logic_propose'][3]['required'], ['ops', 'summary'])
        args = dict(ops=[dict(op='connect', **{'from': 'Button1'}, output='used', to='Door1', input='open')], summary='Open it')
        editor = FakeEditor(dict(ok=True, value=dict(proposed=True, proposal=1)))
        content, error = deusedix_mcp.call_tool(editor, 'logic_propose', args)
        self.assertFalse(error)
        self.assertEqual(editor.calls, [('logic_propose', args, deusedix_mcp.TOOLS['logic_propose'][1])])

    def test_errors_are_tool_errors(self):
        content, error = deusedix_mcp.call_tool(FakeEditor(dict(ok=False, error='No map is open')), 'save', {})
        self.assertTrue(error)
        self.assertEqual(content[0]['text'], 'No map is open')
        self.assertTrue(deusedix_mcp.call_tool(FakeEditor({}), 'format_disk', {})[1])

    def test_project_api_needs_no_page(self):
        content, error = deusedix_mcp.call_tool(FakeEditor(None), 'project_api', {'path': '/api/check?script=x'})
        self.assertFalse(error)
        self.assertEqual(json.loads(content[0]['text'])['path'], '/api/check?script=x')

    def test_project_api_stays_in_the_project_api(self):
        editor = deusedix_mcp.Editor()
        for path in ('http://elsewhere/', '/api/agent/call', '/api/projects/assistant', 'api/maps'):
            with self.assertRaises(ValueError, msg=path):
                editor.api(path)

    def test_no_editor_running_says_so(self):
        with mock.patch.object(agent_bridge, 'editors', return_value={}):
            content, error = deusedix_mcp.call_tool(deusedix_mcp.Editor(), 'editor_state', {})
        self.assertTrue(error)
        self.assertIn('Tools > AI assistant', content[0]['text'])


class LocalOnly(unittest.TestCase):
    """local_guard: DNS rebinding (a site's name pointed at 127.0.0.1) and other sites' pages are refused."""

    def test_hosts(self):
        import local_guard
        for host in ('127.0.0.1:8890', 'localhost:8890', 'LOCALHOST:8890', '[::1]:8890'):
            self.assertTrue(local_guard.host_allowed(host, 8890), host)
        for host in ('evil.example:8890', '127.0.0.1:8891', 'localhost', '', None, '127.0.0.1.evil.example:8890'):
            self.assertFalse(local_guard.host_allowed(host, 8890), host)

    def test_origins(self):
        import local_guard
        for origin in (None, '', 'http://127.0.0.1:8790', 'http://localhost:8891', 'http://[::1]:8890'):
            self.assertTrue(local_guard.origin_allowed(origin), origin)
        for origin in ('http://evil.example', 'http://evil.example:8890', 'null', 'https://localhost:8890',
                       'http://localhost', 'http://127.0.0.1.evil.example:8890', 'http://[bad'):
            self.assertFalse(local_guard.origin_allowed(origin), origin)

    def test_the_server_refuses_a_rebound_request(self):
        import http.client
        from http.server import ThreadingHTTPServer
        import server
        srv = ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        self.addCleanup(srv.server_close)
        self.addCleanup(srv.shutdown)
        port = srv.server_port

        def status(method, path, **headers):
            conn = http.client.HTTPConnection('127.0.0.1', port, timeout=10)
            conn.putrequest(method, path, skip_host=True)
            for k, v in headers.items():
                conn.putheader(k, v)
            conn.putheader('Content-Length', '0')
            conn.endheaders()
            code = conn.getresponse().status
            conn.close()
            return code

        here = '127.0.0.1:%d' % port
        self.assertEqual(status('GET', '/', Host='evil.example:%d' % port), 403)       # the page and its session
        self.assertEqual(status('GET', '/api/projects', Host='evil.example:%d' % port), 403)
        self.assertEqual(status('POST', '/bye?tab=x', Host=here, Origin='http://evil.example'), 403)
        self.assertEqual(status('GET', '/'), 403)                                       # no Host at all
        self.assertEqual(status('GET', '/alive?tab=x', Host=here), 204)                 # the editor's own


class AdvancedTools(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        patcher = mock.patch.object(agent_bridge, 'FILE', Path(self.tmp.name) / 'assistant.json')
        patcher.start()
        self.addCleanup(patcher.stop)
        self.addCleanup(self.tmp.cleanup)

    def page(self, calls):
        calls._asked = time.monotonic()           # a page asked a moment ago

    def test_off_unless_the_second_switch_is_on(self):
        agent_bridge.set_allowed(True, 'http://127.0.0.1:1/', 's', 'C:/One')
        calls = agent_bridge.Calls()
        self.page(calls)
        with self.assertRaises(PermissionError):
            calls.call('run_js', {'code': 'return 1'}, 1)
        agent_bridge.set_allowed(True, 'http://127.0.0.1:1/', 's', 'C:/One', advanced=True)
        self.assertTrue(agent_bridge.advanced())
        with self.assertRaises(TimeoutError):     # let through: it waits for the page
            calls.call('run_js', {'code': 'return 1'}, 0.05)

    def test_switching_off_turns_advanced_off_too(self):
        agent_bridge.set_allowed(True, 'http://127.0.0.1:1/', 's', 'C:/One', advanced=True)
        agent_bridge.set_allowed(False, 'http://127.0.0.1:1/', 's', 'C:/One', advanced=True)
        self.assertFalse(agent_bridge.advanced())
        agent_bridge.set_allowed(True, 'http://127.0.0.1:1/', 's', 'C:/One')
        self.assertFalse(agent_bridge.advanced())
        agent_bridge.set_allowed(True, 'http://127.0.0.1:1/', 's', 'C:/One', advanced=True)
        agent_bridge.register('http://127.0.0.1:2/', 't', 'C:/Two')           # a hub starting keeps the choice
        self.assertTrue(agent_bridge.advanced())

    def test_project_api_only_reads_without_it(self):
        agent_bridge.set_allowed(True, 'http://127.0.0.1:1/', 's', 'C:/One')
        content, error = deusedix_mcp.call_tool(FakeEditor(None), 'project_api', {'path': '/api/edits', 'body': {}})
        self.assertTrue(error)
        self.assertIn('advanced', content[0]['text'])
        self.assertFalse(deusedix_mcp.call_tool(FakeEditor(None), 'project_api', {'path': '/api/check'})[1])

    def test_a_flood_of_calls_is_refused(self):
        calls = agent_bridge.Calls()
        self.page(calls)
        calls._waiting = [dict(id=str(i)) for i in range(agent_bridge.MAX_WAITING)]
        with self.assertRaises(RuntimeError):
            calls.call('state', {}, 1)

    def test_every_tool_says_what_it_does(self):
        self.assertEqual(set(deusedix_mcp.TOOL_KINDS), set(deusedix_mcp.TOOLS))
        tools = deusedix_mcp.handle(None, dict(id=1, method='tools/list'))['result']['tools']
        kinds = {t['name']: t['annotations'] for t in tools}
        self.assertTrue(kinds['find_objects']['readOnlyHint'])
        self.assertTrue(kinds['delete_objects']['destructiveHint'])
        self.assertFalse(kinds['place_object']['destructiveHint'])
        self.assertTrue(all(a['openWorldHint'] is False for a in kinds.values()))
        self.assertIn('never instructions', deusedix_mcp.INSTRUCTIONS)


class Batches(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        patcher = mock.patch.object(agent_bridge, 'FILE', Path(self.tmp.name) / 'assistant.json')
        patcher.start()
        self.addCleanup(patcher.stop)
        self.addCleanup(self.tmp.cleanup)
        agent_bridge.set_allowed(True, 'http://127.0.0.1:1/', 's', 'C:/One')

    def test_the_tools_become_their_operations(self):
        editor = FakeEditor(dict(ok=True, value=dict(done=2)))
        content, error = deusedix_mcp.call_tool(editor, 'batch', {'calls': [
            {'tool': 'place_object', 'args': {'cls': 'MedKit', 'at': [0, 0, 0]}}, {'tool': 'undo'}]})
        self.assertFalse(error)
        self.assertEqual(editor.calls[0][:2], ('batch', {'calls': [dict(op='place', args={'cls': 'MedKit', 'at': [0, 0, 0]}),
                                                                   dict(op='undo', args={})]}))

    def test_a_batch_cannot_reach_around_the_switches(self):
        for tool in ('project_api', 'batch', 'format_disk'):
            content, error = deusedix_mcp.call_tool(FakeEditor({}), 'batch', {'calls': [{'tool': tool}]})
            self.assertTrue(error, tool)
        calls = agent_bridge.Calls()
        calls._asked = time.monotonic()
        with self.assertRaises(PermissionError):                       # run_js inside a batch: still advanced
            calls.call('batch', {'calls': [dict(op='state'), dict(op='run_js', args={'code': ''})]}, 1)
        for bad in ([], [dict(op='batch')], [dict(op='nope')], 'all', [dict(op='state')] * (agent_bridge.MAX_BATCH + 1)):
            with self.assertRaises(ValueError, msg=str(bad)[:40]):
                calls.call('batch', {'calls': bad}, 1)

    def test_new_tools_are_described(self):
        for name in ('find_classes', 'find_textures', 'draw', 'batch'):
            self.assertIn(name, deusedix_mcp.TOOL_KINDS)
        self.assertEqual(deusedix_mcp.TOOL_KINDS['find_classes'], 'read')


if __name__ == '__main__':
    unittest.main()
