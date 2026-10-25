"""deusedix: an MCP server that lets an AI assistant use the DeusEdix editor that is open, as a person at it would.

Started by the assistant (stdio), e.g. for Claude Code:
    claude mcp add deusedix -- "<DeusEdix>\\deusedix-cli.exe" --run "<DeusEdix>\\tools\\mapkit\\deusedix_mcp.py"
(Tools > AI assistant... in the editor shows the exact command, and is where the user allows it.)

Each tool is one call to the editor's page (editor/agent_bridge.py, editor/static/agent.js): what it changes is in the
editor at once, unsaved, with Ctrl+Z, until save. project_api reads the project's server directly (no page needed).

The protocol (JSON-RPC 2.0, one message per line on stdin/stdout) is written here rather than taken from the MCP SDK:
the four requests a tools-only server answers do not need it, and the installed DeusEdix stays without it. Nothing
else may be printed on stdout: it carries the protocol (errors go to stderr).
"""
import base64
import json
import os
from pathlib import Path
import sys
import urllib.error
import urllib.request

sys.path.insert(0, str(Path(__file__).resolve().parent / 'editor'))
import agent_bridge  # noqa: E402

NAME, VERSION = 'deusedix', '1'
PROTOCOLS = ('2025-06-18', '2025-03-26', '2024-11-05')     # newest first: the one answered when the client's is unknown
INSTRUCTIONS = (
    'DeusEdix map editor for Deus Ex and Deus Ex: Revision, open on this PC. Coordinates are Unreal units '
    '(x, y on the floor, z up; a door is about 128 high, JC about 88 tall); yaw 0-65535 (16384 = a quarter turn). '
    'Start with editor_state. Changes are unsaved and undoable like the user\'s own: save, then rebuild to see '
    'geometry and lighting as the game will. Look with view (a picture of the 3D view) only when a picture is needed.')

VEC = {'type': 'array', 'items': {'type': 'number'}, 'minItems': 3, 'maxItems': 3}
OBJ = {'type': 'object'}


def schema(props=None, required=()):
    return {'type': 'object', 'properties': props or {}, 'required': list(required), 'additionalProperties': False}


# name: (page operation or None for project_api, timeout in seconds, description, input schema)
TOOLS = {
    'editor_state': ('state', 20, 'The open project and map, unsaved changes, the selection, the camera, the last '
                     'editor messages and page errors.', schema()),
    'list_maps': ('maps', 20, 'The maps of the project (script names to open).', schema()),
    'open_map': ('open_map', 300, 'Open a map by its script or its name (list_maps). With unsaved changes it refuses, unless save or '
                 'discard is true.', schema({'script': {'type': 'string'}, 'save': {'type': 'boolean'},
                                             'discard': {'type': 'boolean'}}, ['script'])),
    'find_objects': ('find', 30, 'Objects of the open map (actors, blocks, drawn pieces): name, class, label, place. '
                     'Filters: text (in name, class or label), cls, near + radius.',
                     schema({'text': {'type': 'string'}, 'cls': {'type': 'string'}, 'near': VEC,
                             'radius': {'type': 'number'}, 'limit': {'type': 'integer'}})),
    'get_object': ('object', 20, 'Everything about one object: class, place, rotation, its properties (the map\'s '
                   'and the ones changed in the editor), its structure.', schema({'name': {'type': 'string'}}, ['name'])),
    'select_objects': ('select', 20, 'Select objects (several: a group) and, with focus, bring the camera to them.',
                       schema({'names': {'type': 'array', 'items': {'type': 'string'}}, 'focus': {'type': 'boolean'}},
                              ['names'])),
    'place_object': ('place', 60, 'Place a new object of a class (as in the Objects browser: e.g. MedKit, Light, '
                     'TerroristCarcass, PlayerStart). It is cast from `at` along `toward` (default straight down) onto '
                     'the first surface and stands on it as a click would place it; exact: put it at `at` as it is. '
                     'yaw: its facing. props: its properties.',
                     schema({'cls': {'type': 'string'}, 'at': VEC, 'toward': VEC, 'exact': {'type': 'boolean'},
                             'yaw': {'type': 'number'}, 'props': OBJ}, ['cls', 'at'])),
    'move_object': ('move', 30, 'Move, turn or scale an object; a block also takes its size [x, y, z].',
                    schema({'name': {'type': 'string'}, 'loc': VEC, 'yaw': {'type': 'number'},
                            'scale': {'type': 'number'}, 'size': VEC}, ['name'])),
    'set_properties': ('set', 30, 'Set properties of an object as the Inspector does ({"LightBrightness": "200"}); '
                       'null puts one back to the map\'s own value. Values in Unreal\'s text form.',
                       schema({'name': {'type': 'string'}, 'props': OBJ}, ['name', 'props'])),
    'delete_objects': ('delete', 30, 'Delete objects (Ctrl+Z brings them back). When the editor asks to confirm '
                       '(mission objects, structures), the question is returned: call again with confirm true.',
                       schema({'names': {'type': 'array', 'items': {'type': 'string'}}, 'confirm': {'type': 'boolean'}},
                              ['names'])),
    'undo': ('undo', 20, 'Undo the last changes (steps, default 1).', schema({'steps': {'type': 'integer'}})),
    'redo': ('redo', 20, 'Redo what undo took away (steps, default 1).', schema({'steps': {'type': 'integer'}})),
    'save': ('save', 120, 'Save the map and its story.', schema()),
    'rebuild': ('rebuild', 900, 'Save and rebuild the map (geometry, lighting, paths) like the Rebuild button: about '
                'a minute. Returns the build messages.', schema({'mode': {'type': 'string'}})),
    'view': ('view', 60, 'A picture of the 3D view: from where the camera is, from `from` looking at `look_at`, or '
             'framing an object (focus). The camera goes back where it was unless keep is true.',
             schema({'from': VEC, 'look_at': VEC, 'focus': {'type': 'string'}, 'width': {'type': 'integer'},
                     'keep': {'type': 'boolean'}})),
    'story_list': ('story_list', 30, 'The dialogues of the open map\'s story: id, title, who owns it, its steps.',
                   schema()),
    'story_get': ('story_get', 30, 'One dialogue: its settings, its steps (each with its id) and its graph (what '
                  'follows each step).', schema({'dialogue': {'type': 'string'}}, ['dialogue'])),
    'story_write': ('story_write', 30, 'Change a dialogue (fields: its settings; steps: the whole list, as story_get '
                    'gives it) or, with owner and no dialogue, make a new one for that character. Unsaved until save.',
                    schema({'dialogue': {'type': 'string'}, 'owner': {'type': 'string'}, 'fields': OBJ,
                            'steps': {'type': 'array', 'items': OBJ}})),
    'story_play': ('story_play', 30, 'Play-test a dialogue as the game would: state ({flags, credits, health, '
                   'skillpoints, items}) and the answers JC picks in order (choices: their numbers). Returns what is '
                   'said, the choices met and how it ends.',
                   schema({'dialogue': {'type': 'string'}, 'state': OBJ,
                           'choices': {'type': 'array', 'items': {'type': 'integer'}}}, ['dialogue'])),
    'run_js': ('run_js', 60, 'Run JavaScript in the editor\'s page (an async function body; `return` a JSON value). '
               'window.__editor is the editor, window.__story the Story. For what no other tool does.',
               schema({'code': {'type': 'string'}}, ['code'])),
    'project_api': (None, 120, 'Call the project\'s own server, as the page does: GET a path (e.g. '
                    '/api/check?script=...), or POST it with body. No editor page needed.',
                    schema({'path': {'type': 'string'}, 'body': OBJ}, ['path'])),
}


class EditorUnavailable(RuntimeError):
    """DeusEdix is not running, assistants are not allowed in it, or no project is open."""


class HttpError(RuntimeError):
    def __init__(self, status, message, code=None):
        super().__init__(message)
        self.status, self.code = status, code


def _http(url, session, body=None, timeout=30):
    data = None if body is None else json.dumps(body).encode('utf-8')
    req = urllib.request.Request(url, data=data, headers={'X-DeusEdix-Session': session,
                                                          'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            return json.loads(response.read() or b'{}')
    except urllib.error.HTTPError as exc:
        try:
            payload = json.loads(exc.read())
        except ValueError:
            payload = {}
        payload = payload if isinstance(payload, dict) else {}
        raise HttpError(exc.code, payload.get('error') or str(exc), payload.get('code')) from exc


class Editor:
    """The DeusEdix this server talks to: its hub (from assistant.json), and the server of the project open in it."""

    def __init__(self, pinned=os.environ.get('DEUSEDIX_EDITOR', '')):
        self.pinned = pinned                 # an install folder, when several DeusEdix run on this PC
        self.project = None                  # {url, session, project}

    def _hub(self):
        found = agent_bridge.editors()
        if not found:
            raise EditorUnavailable('DeusEdix is not running, or AI assistants are not allowed in it '
                                    '(Tools > AI assistant... in the editor).')
        if self.pinned:
            hub = found.get(self.pinned)
            if not hub:
                raise EditorUnavailable('The DeusEdix of %s is not running for assistants.' % self.pinned)
            return hub
        return max(found.values(), key=lambda h: h.get('since', 0))      # the one started last

    def target(self, fresh=False):
        if self.project and not fresh:
            return self.project
        hub = self._hub()
        try:
            info = _http(hub['url'].rstrip('/') + '/api/assistant/target', hub['session'], timeout=10)
        except (OSError, RuntimeError) as exc:
            raise EditorUnavailable('DeusEdix does not answer (%s). Is it still open?' % exc) from exc
        if not info.get('project'):
            raise EditorUnavailable('DeusEdix is open, but no project is: open one in it.')
        self.project = info
        return info

    def _project(self, send):
        """send(target) on the open project's server; once more with a fresh target when that server is gone or
        is not the open project's any more (another project opened). Never again after a timeout: the call may
        still be running."""
        try:
            return send(self.target())
        except TimeoutError:
            raise
        except HttpError as exc:
            if exc.status != 409 or exc.code == 'page_closed':
                raise
        except OSError:
            pass
        return send(self.target(fresh=True))

    def call(self, op, args, timeout):
        def send(t):
            return _http(t['url'] + 'api/agent/call', t['session'], dict(op=op, args=args, timeout=timeout),
                         timeout=timeout + 15)
        return self._project(send)

    def api(self, path, body=None, timeout=120):
        if not path.startswith('/api/') or path.startswith(('/api/agent/', '/api/project')):
            raise ValueError('project_api takes a path of the project\'s API (/api/...).')
        return self._project(lambda t: _http(t['url'] + path.lstrip('/'), t['session'], body, timeout=timeout))


def _content(value):
    """A page's answer as MCP content: a picture as an image, everything else as compact JSON text."""
    out = []
    if isinstance(value, dict) and isinstance(value.get('image'), str) and value['image'].startswith('data:image/'):
        head, data = value['image'].split(',', 1)
        out.append(dict(type='image', data=data, mimeType=head[5:].split(';')[0]))
        value = {k: v for k, v in value.items() if k != 'image'}
        base64.b64decode(data[:64] + '=' * (-len(data[:64]) % 4))       # a broken picture fails here, not in the client
    out.append(dict(type='text', text=json.dumps(value, ensure_ascii=False, separators=(',', ':'))))
    return out


def call_tool(editor, name, args):
    """tools/call: (content, is_error)."""
    if name not in TOOLS:
        return [dict(type='text', text='Unknown tool: %s' % name)], True
    op, timeout, _desc, _schema = TOOLS[name]
    try:
        if op is None:
            value = editor.api(args.get('path', ''), args.get('body'))
        else:
            answer = editor.call(op, args, timeout)
            if not answer.get('ok'):
                return [dict(type='text', text=answer.get('error') or 'The editor could not do it.')], True
            value = answer.get('value')
        return _content(value), False
    except (EditorUnavailable, ValueError, RuntimeError, OSError) as exc:
        return [dict(type='text', text=str(exc))], True


def handle(editor, message):
    """One JSON-RPC message in, its answer out (None for a notification)."""
    method, ident, params = message.get('method'), message.get('id'), message.get('params') or {}
    if ident is None:                       # notifications/initialized, notifications/cancelled: nothing to answer
        return None
    if method == 'initialize':
        asked = params.get('protocolVersion')
        result = dict(protocolVersion=asked if asked in PROTOCOLS else PROTOCOLS[0],
                      capabilities=dict(tools=dict(listChanged=False)),
                      serverInfo=dict(name=NAME, version=VERSION), instructions=INSTRUCTIONS)
    elif method == 'ping':
        result = {}
    elif method == 'tools/list':
        result = dict(tools=[dict(name=n, description=t[2], inputSchema=t[3]) for n, t in TOOLS.items()])
    elif method == 'tools/call':
        content, error = call_tool(editor, params.get('name', ''), params.get('arguments') or {})
        result = dict(content=content, isError=error)
    else:
        return dict(jsonrpc='2.0', id=ident, error=dict(code=-32601, message='Unknown method: %s' % method))
    return dict(jsonrpc='2.0', id=ident, result=result)


def main(stdin=sys.stdin.buffer, stdout=sys.stdout.buffer):
    editor = Editor()
    for line in stdin:
        if not line.strip():
            continue
        try:
            message = json.loads(line)
        except ValueError:
            answer = dict(jsonrpc='2.0', id=None, error=dict(code=-32700, message='Not JSON.'))
        else:
            answer = handle(editor, message) if isinstance(message, dict) else \
                dict(jsonrpc='2.0', id=None, error=dict(code=-32600, message='Not a request.'))
        if answer is not None:
            stdout.write(json.dumps(answer, ensure_ascii=False).encode('utf-8') + b'\n')
            stdout.flush()


if __name__ == '__main__':
    main()
