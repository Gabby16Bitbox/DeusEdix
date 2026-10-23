"""Conservative, read-only rule cards. This is a source index, not a VM or verifier.

Only lexical if/else and loop scopes are reconstructed. Function calls, jumps,
conversation branches and inherited dispatch are deliberately not simulated.
"""
import hashlib
import json
import re
from collections import defaultdict
from mission_graph import FLAG_CALL, clean, code_mask, source_at, uncomment


def compact(text):
    return re.sub(r'\s+', ' ', text).strip()


def paired(code, start, opening='(', closing=')'):
    depth = 0
    for i in range(start, len(code)):
        if code[i] == opening:
            depth += 1
        elif code[i] == closing:
            depth -= 1
            if not depth:
                return i
    raise ValueError('Unbalanced source')


def flag_calls(text):
    raw, mask = uncomment(text), code_mask(text)
    result, dynamic = [], False
    for m in FLAG_CALL.finditer(raw):
        if not mask[m.start():m.start()+len(m[1])].strip():
            continue
        literal = re.match(r"'([A-Za-z_][A-Za-z0-9_]*)'\s*(?=[,)])", raw[m.end():])
        if not literal:
            dynamic = True
            continue
        end = paired(mask, m.end()-1)
        args = compact(raw[m.end()+literal.end():end]).lstrip(',').strip()
        result.append(dict(flag=literal[1], operation=m[1], write=not m[1].lower().startswith('get'), value=args))
    return result, dynamic


class Blocks:
    """Flatten statements with their enclosing predicates; never execute source."""
    def __init__(self, text):
        self.raw, self.code = uncomment(text), code_mask(text)
        self.rows = []

    def skip(self, p):
        while p < len(self.code) and self.code[p].isspace():
            p += 1
        return p

    def expression(self, p):
        p = self.skip(p)
        if self.code[p:p+1] != '(':
            raise ValueError('Expected parenthesized control condition')
        end = paired(self.code, p)
        return (p+1, end, False), end+1

    def statement(self, p, conditions=(), loops=()):
        p = self.skip(p)
        if p >= len(self.code):
            return p
        if self.code[p] == '{':
            end = paired(self.code, p, '{', '}')
            pos = p+1
            while self.skip(pos) < end:
                pos = self.statement(pos, conditions, loops)
            return end+1
        word = re.match(r'[A-Za-z_]\w*', self.code[p:])
        kind = word[0].lower() if word else ''
        if kind == 'if':
            cond, pos = self.expression(p+len(word[0]))
            pos = self.statement(pos, conditions+(cond,), loops)
            pos = self.skip(pos)
            if re.match(r'else\b', self.code[pos:], re.I):
                pos = self.statement(pos+4, conditions+((cond[0], cond[1], True),), loops)
            return pos
        if kind in ('foreach', 'while', 'for'):
            start = self.skip(p+len(word[0]))
            op = self.code.find('(', start)
            if op < 0:
                raise ValueError('Missing loop expression')
            end = paired(self.code, op)
            return self.statement(end+1, conditions, loops+((p, end+1),))
        # Unsupported control flow is retained as a single, explicitly partial block.
        if kind in ('switch', 'do'):
            brace = self.code.find('{', p)
            if brace < 0:
                raise ValueError('Unsupported unbraced control flow')
            end = paired(self.code, brace, '{', '}')+1
            self.rows.append((p, end, conditions, loops, True))
            return end
        pos = p
        while pos < len(self.code):
            if self.code[pos] == '(':
                pos = paired(self.code, pos)+1
                continue
            if self.code[pos] in ';}':
                end = pos+1 if self.code[pos] == ';' else pos
                if end == p:
                    raise ValueError('Unexpected closing brace')
                self.rows.append((p, end, conditions, loops, False))
                return end
            pos += 1
        raise ValueError('Unterminated statement')

    def functions(self):
        pattern = r'\b(?:function|event)\s+(?:\w+\s+)?(\w+)\s*\('
        for m in re.finditer(pattern, self.code, re.I):
            args = paired(self.code, m.end()-1)
            body = self.skip(args+1)
            if self.code[body:body+1] != '{':
                continue  # Native/abstract declaration; no body to index.
            end = paired(self.code, body, '{', '}')
            self.rows = []
            try:
                self.statement(body)
                yield m[1], body, end, list(self.rows), ''
            except (ValueError, RecursionError) as error:
                yield m[1], body, end, [(body, end+1, (), (), True)], str(error)


def build_rules(graph):
    doc = graph.doc
    rules, gaps = [], []
    scripts = {r['path'].casefold(): r for r in doc.get('scripts', []) if not r.get('headerOnly')}
    short = defaultdict(list)
    for row in scripts.values():
        short[row['path'].rsplit('.', 1)[-1].lower()].append(row)
    bindings = defaultdict(set)
    for edge in graph.edges:
        if edge['relation'] == 'mission script':
            name = edge['target'].removeprefix('script:')
            seen = set()
            while name and name not in seen:
                seen.add(name)
                bindings[name].add(graph.nodes[edge['source']]['label'])
                row = scripts.get(name)
                if not row:
                    candidates = short.get(name.rsplit('.', 1)[-1], [])
                    row = candidates[0] if len(candidates) == 1 else None
                name = (row or {}).get('parent', '').lower()
                if name and '.' not in name:
                    # Prefer the defining package; never merge same-named edition classes.
                    qualified = (row['path'].rsplit('.', 1)[0]+'.'+name).lower()
                    if qualified in scripts:
                        name = qualified
                    elif len(short.get(name, [])) == 1:
                        name = short[name][0]['path'].lower()

    def add(owner, key, title, when, conditions, actions, reads, writes, subjects, maps, scope, missions, evidence, notes=()):
        ident = 'rule:'+hashlib.sha256((owner+'\n'+key).encode()).hexdigest()[:20]
        rules.append(dict(id=ident, owner=owner, title=title, when=when, conditions=conditions, actions=actions,
                          reads=sorted(set(reads), key=str.casefold), writes=sorted(set(writes), key=str.casefold),
                          subjects=sorted(set(subjects)), maps=sorted(set(maps)), mapScope=scope,
                          missions=sorted(set(missions)), evidence=evidence, notes=list(dict.fromkeys(notes))))

    def missions_for(maps, source=''):
        nums = {int(m[:2]) for m in maps if re.match(r'^\d\d_', m)}
        match = re.search(r'(?:^|\.)\w*Mission(\d+)$', source, re.I)
        if not nums and match:
            nums.add(int(match[1]))
        return ['Mission %02d' % n for n in sorted(nums)] or ['Unassigned mission']

    for row in scripts.values():
        text = row.get('text', '')
        owner = 'script:'+row['path'].lower()
        if owner not in graph.nodes:
            continue
        parser = Blocks(text)
        try:
            functions = list(parser.functions())
        except (ValueError, RecursionError) as error:
            gaps.append(dict(source=row['path'], detail=str(error)))
            continue
        for function, begin, end, statements, error in functions:
            local = {}
            declarations = list(re.finditer(r'\blocal\s+([\w.]+)\s+([^;]+);', parser.code[begin:end], re.I))
            declarations += list(re.finditer(r'\bvar(?:\([^)]*\))?\s+(?:(?:transient|config|private|protected|const)\s+)*([\w.]+)\s+([^;{}]+);', parser.code, re.I))
            for m in declarations:
                cls = m[1].rsplit('.', 1)[-1]
                if graph.character(cls):
                    for var in re.findall(r'\b\w+\b', m[2]):
                        local[var.lower()] = cls
            groups = defaultdict(list)
            for statement in statements:
                a, b, conds, loops, partial = statement
                if re.match(r'\s*local\b', parser.code[a:b], re.I):
                    continue
                # A function/map-only container is not one narrative rule. Keep its
                # sibling statements separate unless a non-map predicate binds them.
                guarded = any(not re.fullmatch(r'\s*localURL\s*(?:==|~=)\s*"[\w-]+"\s*', parser.raw[x:y], re.I) for x,y,_ in conds)
                groups[(conds, partial, None if guarded else (loops or ((a,b),)))].append(statement)
            for (conds, partial, _), items in groups.items():
                condtexts = [('NOT ('+compact(parser.raw[a:b])+')') if neg else compact(parser.raw[a:b]) for a,b,neg in conds]
                actiontexts = [compact(parser.raw[a:b]) for a,b,_,_,_ in items]
                looptexts = list(dict.fromkeys(compact(parser.raw[a:b]) for _,_,_,loops,_ in items for a,b in loops))
                combined = '\n'.join(condtexts+actiontexts+looptexts)
                calls, dynamic = flag_calls(combined)
                reads = [c['flag'] for c in calls if not c['write']]
                writes = [c['flag'] for c in calls if c['write']]
                subjects = set()
                own_class = row['path'].rsplit('.', 1)[-1]
                if graph.character(own_class):
                    subjects.add('class:'+own_class.lower())
                mask = code_mask(combined)
                for m in re.finditer(r"\bclass\s*'([\w.]+)'", combined, re.I):
                    if mask[m.start():m.start()+5].strip() and graph.character(m[1].rsplit('.', 1)[-1]):
                        subjects.add('class:'+m[1].rsplit('.', 1)[-1].lower())
                for var, cls in local.items():
                    if re.search(r'\b'+re.escape(var)+r'\b', mask, re.I):
                        subjects.add('class:'+cls.lower())
                for m in re.finditer(r'\bBindName\s*(?:==|~=)\s*"([^"]+)"', combined, re.I):
                    subjects.add('identity:'+m[1].lower())
                if not calls and not subjects and not dynamic:
                    continue
                maps, scope = set(bindings.get(row['path'].lower(), ())), 'script binding'
                # Infer a map only from a whole, positive equality predicate. Complex OR,
                # negation or arbitrary map mentions cannot establish the execution map.
                explicit = []
                for a,b,neg in conds:
                    m = re.fullmatch(r'\s*localURL\s*(?:==|~=)\s*"([\w-]+)"\s*', parser.raw[a:b], re.I)
                    if m and not neg:
                        explicit.append(m[1])
                if len(set(m.lower() for m in explicit)) == 1:
                    maps = {next((m['name'] for m in graph.maps.values() if m['name'].lower()==explicit[-1].lower()), explicit[-1])}
                    scope = 'explicit map condition'
                elif not maps:
                    scope = 'map unresolved'
                notes = ['Static block only: calls and runtime dispatch are not simulated.']
                if len(subjects) > 1:
                    notes.append('Subjects share this block; not every action necessarily targets every subject.')
                if looptexts:
                    notes.append('Actor loops select runtime instances, not one guaranteed character.')
                if dynamic:
                    notes.append('Computed flag names are unresolved; additional readers or writers may exist.')
                if partial or error or re.search(r'\b(?:return|goto|break|continue|switch)\b', parser.code[begin:end], re.I):
                    notes.append('Partial control flow: jumps, returns or switch branches need source review.')
                if scope == 'script binding':
                    notes.append('Maps come from script bindings, including inheritance; dispatch is not proven.')
                a = items[0][0]
                ev = source_at(row, a)
                # Show exact branch evidence, without pretending unrelated sibling branches apply.
                ev['excerpt'] = 'Enclosing conditions (all required):\n'+'\n'.join(condtexts)+'\n\nSource statements (separate spans):\n'+'\n\n'.join(
                    'Line '+str(text.count('\n',0,x)+1)+(' · Loop: '+' / '.join(compact(parser.raw[l:h]) for l,h in loops) if loops else '')+'\n'+text[x:y]
                    for x,y,_,loops,_ in items)
                add(owner, function+':'+str(a), function+' · '+('Set '+writes[0] if writes else 'Check '+reads[0] if reads else 'Character behaviour'),
                    {'Timer':'Timer callback','FirstFrame':'First frame callback','PreTravel':'Before map travel'}.get(function, function+' callback'),
                    condtexts, actiontexts, reads, writes, subjects, maps, scope, missions_for(maps,row['path']), ev, notes)
                rules[-1]['loops'] = looptexts

    for con in doc.get('conversations', []):
        owner = 'conversation:'+con['name'].lower()
        subjects = ['identity:'+str(con.get('owner','')).lower()] if con.get('owner') else []
        ev = dict(file=con.get('path',''), line=0, origin='original', function=con['name'])
        missions = ['Mission %02d' % int(n) for n in con.get('missions', []) if str(n).isdigit()] or ['Unassigned mission']
        requirements = con.get('requires', [])
        conditions = [str(f.get('flag'))+' = '+str(f.get('value')).lower() for f in requirements if f.get('flag')]
        if requirements or subjects:
            add(owner, 'entry', con['name']+' · Entry', 'Conversation eligibility check', conditions,
                ['Conversation may start; interaction and game state still apply.'], [f['flag'] for f in requirements if f.get('flag')], [], subjects,
                [], 'conversation map unresolved', missions, ev, ['Conversation owner is an identity, not a single map instance.'])
        for i, event in enumerate(con.get('events', [])):
            typ = event.get('type', '')
            eventrows = [(str(i), event.get('flags', []), typ.lower() in ('setflag','setflags'), '')]
            eventrows += [(str(i)+':choice:'+str(j), choice.get('flags', []), True, ' · Choice '+str(j+1)) for j,choice in enumerate(event.get('choices', []))]
            for key, flags, write, suffix in eventrows:
                flags = [f for f in flags if f.get('flag')]
                if not flags:
                    continue
                evidence = dict(ev, excerpt=json.dumps(event if not suffix else flags, ensure_ascii=False, indent=2)[:6000])
                values = [f['flag']+' = '+str(f.get('value')).lower() for f in flags]
                add(owner, key, con['name']+' · '+typ+suffix, 'When conversation reaches event '+str(i+1)+suffix,
                    conditions, [('Write ' if write else 'Check ')+v for v in values],
                    [f['flag'] for f in requirements if f.get('flag')]+([] if write else [f['flag'] for f in flags]),
                    [f['flag'] for f in flags] if write else [], subjects, [], 'conversation map unresolved', missions, evidence,
                    ['Conversation branches and choices are not simulated; these events are not guaranteed to run together.'])

    # Authored editor rules already have explicit owners/maps. Keep one card per rule,
    # distinguish conditional/choice actions, and reuse the graph's saved schema semantics.
    for node in list(graph.nodes.values()):
        if node['kind'] not in ('event','dialogue') or node.get('origin') != 'editor':
            continue
        edges = [e for e in graph.edges if node['id'] in (e['source'],e['target'])]
        reads = [graph.nodes[e['source']]['label'] for e in edges if e['relation']=='reads state']
        writes = [graph.nodes[e['target']]['label'] for e in edges if e['relation']=='writes state']
        subjects = [e['target'] for e in edges if graph.nodes[e['target']]['kind'] in ('character','object')]
        evidence = next((e['evidence'] for e in edges if e.get('evidence',{}).get('file')), {})
        m = graph.maps.get(node.get('map','').lower(), {})
        category = 'links' if '/interaction/' in node['id'] else node['id'].split('/')[-2]
        rows = m.get('edits' if category=='links' else 'story',{}).get(category,[])
        item = next((x for i,x in enumerate(rows) if str(x.get('id',i)).lower()==node['id'].split('/')[-1]), {})
        def describe(value):
            return json.dumps(value, ensure_ascii=False, sort_keys=True)
        evidence = dict(evidence, excerpt=json.dumps(item, ensure_ascii=False, indent=2))
        add(node['id'], 'editor', node['label'], 'Saved '+category+' rule',
            [describe(item[k]) for k in ('when','requires') if item.get(k)],
            [describe(item[k]) for k in ('actions','steps','options') if item.get(k)] or ['See saved rule source for actions.'],
            reads, writes, subjects, [node['map']], 'authored map', missions_for([node['map']]), evidence,
            ['Saved rule only; dialogue choices and dynamic area recipients are not simulated.'])

    return dict(version=1, items=rules, gaps=gaps,
                policy='Literal flag access only. No flag access found is not proof of no dependency. Dynamic names, native code and missing sources remain unverified.')
