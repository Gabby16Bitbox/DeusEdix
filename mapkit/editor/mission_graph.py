"""Read-only mission dependency index. Never executes project scripts or builds maps.

Only literal dependencies are asserted. Dynamic lookups and missing sources remain
visible coverage gaps, not a promise that changing the story is safe.
"""
from contextlib import nullcontext
import ast
from bisect import bisect_right
from functools import lru_cache
import hashlib
import json
import re
import threading
import time
import struct
from pathlib import Path

VERSION = 2
_lock = threading.RLock()
_job = {'state': 'idle', 'phase': 'Not scanned', 'done': 0, 'total': 0, 'result': None}
_map_cache = {}
NAME = re.compile(r'^[A-Za-z0-9_-]{1,64}$')
FLAG_CALL = re.compile(r"\b(GetBool|SetBool|GetInt|SetInt|GetByte|SetByte|GetFloat|SetFloat|GetName|SetName|GetString|SetString|DeleteFlag|ClearFlag|SetFlag)\s*\(\s*", re.I)


def clean(value):
    return str(value or '').strip().strip('"').strip("'")


def uncomment(text):
    # Preserve string literals and offsets; comments inside strings are not comments.
    token = re.compile(r'"(?:\\.|[^"\\])*"|\'(?:[^\'\n])*\'|//[^\n]*|/\*[\s\S]*?\*/')
    return token.sub(lambda m: re.sub(r'[^\n]', ' ', m[0]) if m[0].startswith(('/', '/*')) else m[0], text)


def code_mask(text):
    return re.sub(r'"(?:\\.|[^"\\])*"|\'[^\'\n]*\'', lambda m: ' ' * len(m[0]), uncomment(text))


@lru_cache(maxsize=2000)
def _source_index(text):
    functions = list(re.finditer(r'\b(?:function|event)\s+(?:\w+\s+)?(\w+)\s*\(', code_mask(text), re.I))
    return text.splitlines(), functions, [m.start() for m in functions]


def source_at(row, offset=0):
    text = row.get('text', '')
    line = text.count('\n', 0, offset) + 1
    lines, functions, positions = _source_index(text)
    pos = bisect_right(positions, offset)-1
    return dict(file=row.get('file', row.get('path', '')), line=line,
                function=functions[pos][1] if pos >= 0 else '', origin=row.get('origin', 'original'),
                excerpt='\n'.join(lines[max(0, line-3):line+2])[:1600])


class Graph:
    def __init__(self, document):
        self.doc = document
        self.nodes = {}
        self.edges = []
        self.edge_keys = set()
        self.findings = []
        self.maps = {m['name'].casefold(): m for m in document.get('maps', [])}
        self.actors = {}
        self.parents = {r['path'].split('.')[-1].casefold(): r.get('parent', '').split('.')[-1] for r in document.get('scripts', [])}
        self.script_classes = {r['path'].split('.')[-1].casefold(): r['path'] for r in document.get('scripts', [])
                               if not r.get('headerOnly') and (FLAG_CALL.search(code_mask(r.get('text', ''))) or 'mission' in r['path'].casefold())}
        for m in self.maps.values():
            self.node('map', m['name'], label=m['name'], origin=m.get('origin', 'original'), map=m['name'])
            for a in m.get('actors', []):
                self.actors[(m['name'].casefold(), a['name'].casefold())] = a

    def node(self, kind, key, label=None, **extra):
        ident = kind + ':' + str(key).casefold()
        if ident not in self.nodes:
            self.nodes[ident] = dict(id=ident, kind=kind, label=label or str(key), **extra)
        else:
            # Forward references create placeholders before their definition is scanned.
            self.nodes[ident].update(extra)
        return ident

    def edge(self, start, end, relation, source=None, certainty='literal'):
        source = source or {}
        key = (start, end, relation, source.get('file', ''), source.get('line', 0))
        if key in self.edge_keys:
            return
        self.edge_keys.add(key)
        self.edges.append(dict(id='e'+str(len(self.edges)), source=start, target=end, relation=relation,
                               certainty=certainty, evidence=source))

    def issue(self, severity, title, detail, nodes=(), source=None):
        self.findings.append(dict(id='f'+str(len(self.findings)), severity=severity, title=title,
                                  detail=detail, nodes=list(nodes), evidence=source or {}))

    def character(self, cls):
        seen = set()
        while cls and cls.casefold() not in seen:
            seen.add(cls.casefold())
            if cls.casefold() in ('scriptedpawn', 'deusexplayer'):
                return True
            cls = self.parents.get(cls.casefold(), '')
        return False

    def actor(self, map_name, name):
        key = (map_name.casefold(), name.casefold())
        a = self.actors.get(key)
        if a is None:
            return self.node('object', map_name+'/'+name, label=name, map=map_name, missing=True, origin='project')
        p = {k.casefold(): clean(v) for k,v in a.get('props', {}).items()}
        cls = a.get('cls', '').split('.')[-1]
        kind = 'character' if self.character(cls) or p.get('bindname', '').casefold() not in ('', 'none') else 'object'
        ident = self.node(kind, map_name+'/'+name, label=name, map=map_name, actor=name, cls=cls,
                          deleted=a.get('deleted', False), origin=a.get('origin', self.maps[map_name.casefold()].get('origin', 'original')))
        self.edge(self.node('map', map_name), ident, 'contains')
        if kind == 'character':
            class_id = self.node('character-class', cls, label=cls, origin='original' if not cls.startswith('UC') else 'project')
            self.edge(ident, class_id, 'instance of')
        bind = p.get('bindname', '')
        if bind and bind.casefold() != 'none':
            inherited = 'BindName' in a.get('inherited', [])
            self.edge(ident, self.node('identity', bind, label=bind), 'dialogue identity',
                      dict(file=a.get('defaults_file', ''), origin=a.get('origin', 'original')) if inherited else {},
                      certainty='inherited' if inherited else 'literal')
        return ident

    def target(self, owner, map_name, name, relation, evidence):
        if not name or name == '@player':
            return
        target = self.actor(map_name, name)
        self.edge(owner, target, relation, evidence)
        actor = self.actors.get((map_name.casefold(), name.casefold()))
        if actor and actor.get('deleted'):
            self.issue('error', 'Target was deleted', f'{name} is deleted, but this saved rule still references it.', [owner, target], evidence)
        elif not actor:
            complete = self.maps.get(map_name.casefold(), {}).get('complete', False)
            self.issue('error' if complete else 'unknown', 'Target not found' if complete else 'Target not verified',
                       f'{name} is not in the '+('scanned map.' if complete else 'available map snapshot; build or open that map to inspect it.'), [owner, target], evidence)

    def state(self, owner, flag, write, evidence):
        if flag:
            node = self.node('flag', flag, label=flag)
            self.edge(owner if write else node, node if write else owner, 'writes state' if write else 'reads state', evidence)

    def travel(self, owner, value, evidence, current=''):
        parts = clean(value).split('?', 1)[0].split('#', 1)
        dest = parts[0].split('/', 1)[0]
        if not dest:
            return
        known = self.maps.get(dest.casefold())
        node = self.node('map', dest, label=known['name'] if known else dest, map=dest, missing=not bool(known))
        self.edge(owner, node, 'travels to', evidence)
        if not known:
            self.issue('review', 'Destination outside scanned maps', f'{dest} could be external or unavailable. Its existence is not verified.', [owner, node], evidence)

    def map_objects(self):
        for m in self.maps.values():
            tag_owners = {}
            for a in m.get('actors', []):
                p = {k.casefold(): clean(v) for k,v in a.get('props', {}).items()}
                tag = p.get('tag', '')
                if tag and tag.casefold() not in ('none', a.get('cls', '').split('.')[-1].casefold()) and not a.get('deleted'):
                    tag_owners.setdefault(tag.casefold(), []).append(a)
                relevant = self.character(a.get('cls', '').split('.')[-1]) or any(p.get(k, '').casefold() not in ('', 'none') for k in ('bindname', 'event', 'failevent', 'destmap', 'url', 'script')) or bool(tag and tag.casefold() not in ('none', a.get('cls', '').split('.')[-1].casefold()))
                if not relevant:
                    continue
                node = self.actor(m['name'], a['name'])
                ev = dict(file=m.get('file', ''), origin=a.get('origin', m.get('origin', 'original')), line=0)
                if tag and tag.casefold() not in ('none', a.get('cls', '').split('.')[-1].casefold()):
                    self.edge(self.node('engine-tag', m['name']+'/'+tag, label=tag, map=m['name']), node, 'native receiver', ev)
                for field in ('event', 'failevent'):
                    value = p.get(field, '')
                    if value and value.casefold() != 'none':
                        self.edge(node, self.node('engine-tag', m['name']+'/'+value, label=value, map=m['name']), 'fires '+field, ev)
                if p.get('destmap') or p.get('url'):
                    self.travel(node, p.get('destmap') or p['url'], ev, m['name'])
                script = p.get('script', '')
                found = re.search(r"(?:Class')?([A-Za-z0-9_]+\.[A-Za-z0-9_]+)", script)
                if found and a.get('cls', '').split('.')[-1] == 'DeusExLevelInfo':
                    self.edge(self.node('map', m['name']), self.node('script', found[1], label=found[1]), 'mission script', ev)

    def scripts(self):
        for row in self.doc.get('scripts', []):
            if row.get('headerOnly'):
                continue
            text = row.get('text', '')
            raw = uncomment(text)
            code = code_mask(text)
            calls = list(FLAG_CALL.finditer(raw))
            refs = list(re.finditer(r"\bclass\s*'([A-Za-z0-9_.]+)'", raw, re.I))
            meaningful = calls or any(self.character(m[1].split('.')[-1]) or m[1].split('.')[-1].casefold() in self.script_classes for m in refs) or 'mission' in row['path'].casefold()
            if not meaningful:
                continue
            owner = self.node('script', row['path'], label=row['path'], origin=row.get('origin', 'original'))
            self.nodes[owner]['evidence'] = source_at(row)
            if row.get('parent') and 'mission' in row['path'].casefold():
                self.edge(owner, self.node('script', row['parent'], label=row['parent']), 'inherits', source_at(row))
            for match in calls:
                # A word inside a quoted string cannot be a method call.
                if not code[match.start():match.start()+len(match[1])].strip():
                    continue
                ev = source_at(row, match.start())
                literal = re.match(r"'([A-Za-z_][A-Za-z0-9_]*)'\s*[,)]", raw[match.end():])
                if literal:
                    self.state(owner, literal[1], not match[1].lower().startswith('get'), ev)
                else:
                    self.issue('unknown', 'Dynamic state lookup', 'The state name is computed at runtime. Its dependencies cannot be inferred reliably.', [owner], ev)
            for match in refs:
                if not code[match.start():match.start()+5].strip():
                    continue
                if self.character(match[1].split('.')[-1]):
                    self.edge(owner, self.node('character-class', match[1].split('.')[-1], label=match[1].split('.')[-1]), 'uses character class', source_at(row, match.start()))
                elif match[1].split('.')[-1].casefold() in self.script_classes:
                    target = self.script_classes[match[1].split('.')[-1].casefold()]
                    self.edge(owner, self.node('script', target, label=target), 'references runtime logic', source_at(row, match.start()))
            for match in re.finditer(r'"([A-Za-z0-9_-]{1,64})"|\'([A-Za-z0-9_-]{1,64})\'', raw):
                name = match[1] or match[2]
                if name.casefold() in self.maps:
                    self.edge(owner, self.node('map', name, label=self.maps[name.casefold()]['name']), 'mentions map', source_at(row, match.start()))
            for match in re.finditer(r'\b(?:SendPlayer|ClientTravel|ServerTravel)\s*\(\s*"([^"\r\n]+)"', raw, re.I):
                if code[match.start():match.start()+3].strip():
                    self.travel(owner, match[1], source_at(row, match.start()))
            if re.search(r'\b(?:AllActors|DynamicLoadObject|GetPawn|GetActor)\s*\(', code, re.I):
                self.issue('unknown', 'Runtime actor selection', 'Class references are shown, but loops, computed names and spawn timing do not identify one guaranteed actor instance.', [owner], source_at(row))

    def narrative(self):
        for m in self.maps.values():
            name = m['name']
            for category in ('dialogues', 'events', 'infolinks'):
                for index, item in enumerate(m.get('story', {}).get(category, [])):
                    if item.get('disabled'):
                        continue
                    owner = self.node('dialogue' if category == 'dialogues' else 'event', name+'/'+category+'/'+str(item.get('id', index)),
                                      label=item.get('title') or item.get('replaces') or str(item.get('id', category)), map=name, origin='editor')
                    ev = dict(file=m.get('story_file', ''), line=0, origin='editor', function=category)
                    self.edge(self.node('map', name), owner, 'authored story', ev)
                    self.target(owner, name, item.get('owner', ''), 'speaker', ev)
                    if item.get('replaces'):
                        original = self.node('conversation', item['replaces'], label=item['replaces'], origin='original')
                        self.edge(owner, original, 'replaces in '+name, ev)
                    self.walk(owner, name, item, ev)
            for index, item in enumerate(m.get('edits', {}).get('links', [])):
                if item.get('disabled'):
                    continue
                owner = self.node('event', name+'/interaction/'+str(item.get('id', index)), label=item.get('label') or 'Interaction '+str(item.get('id', index)), map=name, origin='editor')
                ev = dict(file=m.get('edits_file', ''), origin='editor', line=0, function='Interactions')
                self.edge(self.node('map', name), owner, 'interaction', ev)
                self.target(owner, name, item.get('src'), 'triggered by', ev)
                self.walk(owner, name, item, ev)
            for actor, item in m.get('edits', {}).get('objectTags', {}).items():
                if item.get('mode') == 'manual':
                    self.edge(self.actor(name, actor), self.node('scripting-tag', name+'/'+item['value'], label=item['value'], map=name), 'logical tag', dict(file=m.get('edits_file', ''), origin='editor'))

    def walk(self, owner, map_name, value, evidence, parent=''):
        if isinstance(value, list):
            for child in value:
                self.walk(owner, map_name, child, evidence, parent)
        elif isinstance(value, dict):
            typ = value.get('type') or value.get('verb')
            if value.get('flag'):
                self.state(owner, value['flag'], (typ == 'flag' and parent not in ('when', 'requires')) or parent == 'options', evidence)
            if typ == 'flag' and value.get('a'):
                self.state(owner, value['a'], True, evidence)
            if typ in ('npc', 'door', 'dead'):
                self.target(owner, map_name, value.get('actor'), 'waits for outcome' if typ == 'dead' else 'changes '+str(value.get('act', 'actor')), evidence)
            if value.get('target') and not value.get('targetTag') and not value.get('area'):
                self.target(owner, map_name, value['target'], 'action: '+str(typ or 'target'), evidence)
            if value.get('targetTag'):
                self.edge(owner, self.node('scripting-tag', map_name+'/'+value['targetTag'], label=value['targetTag'], map=map_name), 'targets logical tag', evidence)
            if isinstance(value.get('area'), dict):
                area = value['area']
                for member in area.get('members', []):
                    self.target(owner, map_name, member, 'saved area member', evidence)
                if area.get('dynamic') or area.get('tag'):
                    self.issue('unknown', 'Runtime area selection', 'Recipients also depend on position, radius and the current logical tag at runtime.', [owner], evidence)
            if typ == 'travel':
                self.travel(owner, value.get('map') or value.get('a'), evidence)
            if typ == 'trigger' and value.get('tag'):
                self.edge(owner, self.node('engine-tag', map_name+'/'+value['tag'], label=value['tag'], map=map_name), 'fires native event', evidence)
            for key, child in value.items():
                if isinstance(child, (list, dict)):
                    self.walk(owner, map_name, child, evidence, key)

    def conversations(self):
        for con in self.doc.get('conversations', []):
            owner = self.node('conversation', con['name'], label=con['name'], origin='original')
            ev = dict(file=con.get('path', ''), origin='original', line=0, function='Conversation')
            if con.get('owner'):
                self.edge(self.node('identity', con['owner'], label=con['owner']), owner, 'original conversation', ev)
            for f in con.get('requires', []):
                self.state(owner, f.get('flag'), False, ev)
            for event in con.get('events', []):
                write = event.get('type', '').casefold() in ('setflag', 'setflags')
                for flag in event.get('flags', []):
                    self.state(owner, flag.get('flag'), write, ev)
                for choice in event.get('choices', []):
                    for flag in choice.get('flags', []):
                        self.state(owner, flag.get('flag'), True, ev)

    def result(self):
        from mission_rules import build_rules
        self.map_objects()
        self.scripts()
        self.conversations()
        self.narrative()
        rules = build_rules(self)
        for gap in rules['gaps']:
            self.issue('unknown', 'Rule extraction incomplete', gap['detail'],
                       ['script:'+gap['source'].casefold()], dict(file=gap['source']))
        for note in self.doc.get('notices', []):
            self.issue('unknown', note['title'], note['detail'], note.get('nodes', []))
        return dict(version=VERSION, project=self.doc.get('project', {}), nodes=list(self.nodes.values()), edges=self.edges,
                    findings=self.findings, coverage=self.doc.get('coverage', {}), readOnly=True,
                    generatedAt=time.time(), rules=rules, policy='Static references only; runtime branches and narrative consistency are not proven.')


def _json(path):
    return json.loads(path.read_text(encoding='utf-8-sig'))


def _offline_actors(path):
    """Existing offline UE1 reader; no game or compiler is started."""
    import ue1pkg
    stamp = (str(path), path.stat().st_size, path.stat().st_mtime_ns)
    if stamp in _map_cache:
        return _map_cache[stamp]
    pkg = ue1pkg.Pkg(str(path))
    def qualified(ref, seen=()):
        if not ref or ref in seen:
            return ''
        if ref < 0:
            item = pkg.imports[-ref-1];outer, name = item[2], item[3]
        else:
            item = pkg.exports[ref-1];outer, name = item['pkg'], item['name']
        prefix = qualified(outer, (*seen, ref))
        return prefix+'.'+name if prefix else name
    rows, failures = [], 0
    skip = {'class', 'level', 'model', 'polys', 'brush', 'texture', 'sound', 'textbuffer', 'palette', 'mesh', 'lodmesh', 'vertmesh', 'reachspec', 'decals', 'navigationpoint'}
    for index, item in enumerate(pkg.exports):
        cls = pkg.classname(item)
        if cls.casefold() in skip or not item['size']:
            continue
        try:
            values = {key: (qualified(value[1]) if key.casefold() == 'script' and isinstance(value, tuple) and value[0] == 'ref' else pkg.pval(value)) for key, _, _, value in pkg.props(index+1)}
            rows.append(dict(name=item['name'], cls=cls, props=values))
        except (ValueError, IndexError, KeyError, TypeError, UnicodeError, struct.error):
            failures += 1
    _map_cache[stamp] = rows, failures
    return rows, failures


def collect_project(progress, read_sources=False, sdk_lock=None):
    import settings
    import data
    import dxmaps
    import gamecons
    import gamecontent
    import maplinks
    import props
    kit = data.KIT
    project = kit.parents[1]
    doc = dict(project=dict(name=(getattr(settings, 'PROJECT_META', {}) or {}).get('name') or ('UNATCO Continues' if not settings.STANDALONE else 'DeusEdix'),
                            target=settings.TARGET, kind=settings.PROJECT_KIND, package=settings.PACKAGE),
               maps=[], scripts=[], conversations=[], notices=[], coverage={})
    packages = ['DeusEx'] + (['RevisionMission'] if settings.TARGET == 'revision' else [])
    for index, package in enumerate(packages):
        progress('Reading '+package+' sources', index, len(packages))
        try:
            # Class inheritance is available offline even before source export.
            import ue1pkg
            binary = ue1pkg.Pkg(str(gamecons._package(package)))
            doc['scripts'].extend(dict(path=package+'.'+r['name'], parent=binary.refname(r['super']), text='', headerOnly=True)
                                  for r in binary.exports if binary.classname(r) == 'Class')
        except (OSError, ValueError, IndexError, struct.error) as error:
            doc['notices'].append(dict(title='Class headers unavailable: '+package, detail=str(error)))
        try:
            if read_sources:
                with sdk_lock or nullcontext():
                    rows = gamecontent.exported(package, 'scripts')
            else:
                saved = _json(gamecontent.CACHE / (package+'-scripts.json'))
                stamp = gamecons._stamp([gamecons._package(package), gamecons._package('Extension')])
                if saved.get('signature') != stamp or saved.get('version') != gamecontent.VERSION:
                    raise ValueError('Cached sources are out of date.')
                rows = saved['rows']
            doc['scripts'].extend(dict(row, origin='original', file=row['path']) for row in rows)
        except (OSError, ValueError, RuntimeError) as error:
            doc['notices'].append(dict(title='Game source unavailable: '+package, detail=str(error)+' Use Read game sources to refresh the analysis cache.'))
    for path in sorted((project / 'src').glob('*/Classes/*.uc')):
        text = path.read_text(encoding='latin1')
        declaration = re.search(r'\bclass\s+(\w+)\s+extends\s+([\w.]+)', uncomment(text), re.I)
        if declaration:
            doc['scripts'].append(dict(path=path.parents[1].name+'.'+declaration[1], parent=declaration[2], text=text, file=str(path), origin='project'))
    progress('Reading conversations', 0, 1)
    try:
        if read_sources:
            with sdk_lock or nullcontext():
                catalog = gamecons.catalog(settings.CONVERSATIONS, log=lambda *a: None)
        else:
            catalog = _json(gamecons.CACHE / (settings.CONVERSATIONS+'.json'))
            if catalog.get('signature') != gamecons._stamp(gamecons._files(settings.CONVERSATIONS)) or catalog.get('version') != gamecons.VERSION:
                raise ValueError('Cached conversations are out of date.')
        doc['conversations'] = catalog.get('conversations', [])
    except (OSError, ValueError, RuntimeError) as error:
        doc['notices'].append(dict(title='Original conversations unavailable', detail=str(error)+' Use Read game sources to fill this coverage gap.'))
    defaults = {}
    try:
        if read_sources:
            with sdk_lock or nullcontext():
                reflected = props.defaults(log=lambda *a: None)
        else:
            reflected = _json(props.CACHE)
            if reflected.get('version') != props.VERSION:
                raise ValueError('Cached class defaults are out of date.')
        defaults = reflected.get('classes', {})
    except (OSError, ValueError, RuntimeError) as error:
        doc['notices'].append(dict(title='Inherited identities unavailable', detail=str(error)+' Default BindName values cannot be resolved. Use Read game sources.'))
    scripts = {}
    for path in (kit / 'maps').glob('*.py'):
        try:
            tree = ast.parse(path.read_text(encoding='utf-8-sig'))
            for item in tree.body:
                if isinstance(item, ast.Assign) and any(isinstance(t, ast.Name) and t.id == 'MAP' for t in item.targets) and isinstance(item.value, ast.Constant) and isinstance(item.value.value, str):
                    scripts[item.value.value] = path
        except (OSError, SyntaxError) as error:
            doc['notices'].append(dict(title='Map generator not parsed', detail=path.name+': '+str(error)))
    names = sorted(set(maplinks.all_maps()) | set(scripts))
    complete = 0
    for index, name in enumerate(names):
        progress('Reading '+name, index, len(names))
        if not NAME.fullmatch(name):
            continue
        m = dict(name=name, actors=[], complete=False, origin='project' if name in scripts or (dxmaps.MOD_MAPS/(name+'.dx')).exists() else 'original')
        doc['maps'].append(m)
        edits_path = kit/'maps'/((scripts[name].stem if name in scripts else name)+'.edits.json')
        story_path = kit/'story'/(name+'.json')
        m.update(edits_file=str(edits_path), story_file=str(story_path))
        for key, path in [('edits', edits_path), ('story', story_path)]:
            try:
                m[key] = _json(path) if path.exists() else {}
                if not isinstance(m[key], dict):
                    raise ValueError('Expected a JSON object.')
            except (OSError, ValueError) as error:
                m[key] = {}
                doc['notices'].append(dict(title='Saved data unavailable', detail=str(path)+': '+str(error), nodes=['map:'+name.casefold()]))
        try:
            # Prefer authoring source, not a possibly stale private build with old edits.
            path = dxmaps.source(name) if name not in scripts else data.OUT/(name+'.dx')
            if path.exists():
                rows, failures = _offline_actors(path)
                m.update(actors=rows, file=str(path), complete=failures == 0)
                if name in scripts and scripts[name].stat().st_mtime_ns > path.stat().st_mtime_ns:
                    m['complete'] = False
                    doc['notices'].append(dict(title='Newer map generator', detail=name+': the generator changed after the last build. Its new objects may not be in this snapshot.', nodes=['map:'+name.casefold()]))
                if failures:
                    doc['notices'].append(dict(title='Partial map properties', detail=f'{name}: {failures} exports could not be decoded. Missing references are not proven broken.', nodes=['map:'+name.casefold()]))
            else:
                raise FileNotFoundError('No built snapshot for '+name)
        except (OSError, ValueError, RuntimeError) as error:
            doc['notices'].append(dict(title='Map snapshot unavailable', detail=name+': '+str(error), nodes=['map:'+name.casefold()]))
        # Apply saved overlays in memory only. They are never saved or rebuilt here.
        actors = {a['name']: dict(a, props=dict(a.get('props', {}))) for a in m['actors']}
        edits = m.get('edits', {})
        for a in edits.get('added', []):
            actors[a['name']] = dict(a, origin='editor', props=dict(a.get('props', {})))
        for actor in actors.values():
            values=defaults.get(actor['cls'].split('.')[-1], {}).get('props', {})
            actor['inherited']=[]
            for field in ('BindName','Tag','Event','FailEvent','URL','DestMap'):
                if field not in actor['props'] and values.get(field):
                    actor['props'][field]=values[field][0]
                    actor['inherited'].append(field)
            actor['defaults_file']=str(props.CACHE)
        for actor, changes in edits.get('props', {}).items():
            if actor in actors:
                actors[actor]['props'].update(changes)
                actors[actor]['inherited']=[f for f in actors[actor].get('inherited', []) if f not in changes]
        for actor in edits.get('deleted', {}):
            if edits['deleted'][actor] and actor in actors:
                actors[actor]['deleted'] = True
        m['actors'] = list(actors.values())
        complete += bool(m['complete'])
    doc['coverage'] = dict(maps=len(doc['maps']), completeMaps=complete, sourceClasses=sum(not r.get('headerOnly') for r in doc['scripts']),
                           conversations=len(doc['conversations']), gaps=len(doc['notices']), savedOnly=True)
    return doc


def status():
    with _lock:
        return dict(_job)


def start(read_sources=False, sdk_lock=None, operation=nullcontext):
    global _job
    with _lock:
        if _job['state'] == 'running':
            return dict(_job)
        token = hashlib.sha256(str(time.time_ns()).encode()).hexdigest()[:16]
        _job = dict(state='running', token=token, phase='Starting read-only scan', done=0, total=0, result=None)
    def progress(phase, done, total):
        with _lock:
            _job.update(phase=phase, done=done, total=total)
    def work():
        try:
            with operation():
                document = collect_project(progress, read_sources, sdk_lock)
                progress('Connecting dependencies', 0, 1)
                result = Graph(document).result()
            with _lock:
                _job.update(state='ready', phase='Scan complete', done=1, total=1, result=result)
        except Exception as error:
            with _lock:
                _job.update(state='error', phase='Scan failed', error=str(error), result=None)
    threading.Thread(target=work, name='mission-graph-reader', daemon=True).start()
    return status()
