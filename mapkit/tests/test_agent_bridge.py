"""The AI assistant's way into the editor: the user's switch (agent_bridge.set_allowed), calls held for the page
(agent_bridge.Calls) and the MCP server's protocol and tools (deusedix_mcp.py)."""
import io
import json
import sys
import tempfile
import threading
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


if __name__ == '__main__':
    unittest.main()
