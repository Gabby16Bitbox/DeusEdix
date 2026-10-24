"""No function names a local like a module the file imports and then uses that module in it: the local wins, and
`module.function()` breaks only when that line runs (24 Oct 2026: dxmaps.build() kept the added actors' T3D in a
list called `blocks`, so `blocks.brushes()` of the blocks module failed for every block added to an original map)."""
import ast
import unittest
from pathlib import Path

KIT = Path(__file__).resolve().parents[1]


def modules_of(tree):
    names = set()
    for node in tree.body:
        if isinstance(node, ast.Import):
            names |= {(a.asname or a.name).split('.')[0] for a in node.names}
    return names


def own_nodes(fn):
    """The nodes of a function, not those of the functions and classes inside it (their locals are theirs)."""
    todo = list(ast.iter_child_nodes(fn))
    while todo:
        n = todo.pop()
        yield n
        if not isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef, ast.Lambda, ast.ClassDef)):
            todo.extend(ast.iter_child_nodes(n))


def shadowed(path):
    tree = ast.parse(path.read_text(encoding='utf-8-sig'))
    mods, out = modules_of(tree), []
    for fn in ast.walk(tree):
        if not isinstance(fn, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        local = {t.id for n in own_nodes(fn) if isinstance(n, (ast.Assign, ast.AugAssign, ast.AnnAssign, ast.For, ast.With))
                 for t in ast.walk(n.targets[0] if isinstance(n, ast.Assign) and len(n.targets) == 1 else
                                   getattr(n, 'target', None) or ast.Tuple(elts=[], ctx=ast.Store()))
                 if isinstance(t, ast.Name) and isinstance(t.ctx, ast.Store)}
        local |= {a.arg for a in fn.args.args + fn.args.kwonlyargs}
        local -= {name for n in own_nodes(fn) if isinstance(n, ast.Global) for name in n.names}
        imported_here = {(a.asname or a.name).split('.')[0] for n in own_nodes(fn) if isinstance(n, ast.Import) for a in n.names}
        for name in sorted((local & mods) - imported_here):
            # used as the module in the same function: name.attr(...) where the module has that function
            if any(isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute) and isinstance(n.func.value, ast.Name)
                   and n.func.value.id == name and n.func.attr not in ('append', 'extend', 'get', 'items', 'keys',
                                                                        'values', 'pop', 'update', 'add', 'copy')
                   for n in own_nodes(fn)):
                out.append('%s:%d %s() has a local %r' % (path.name, fn.lineno, fn.name, name))
    return out


class ModuleShadowing(unittest.TestCase):
    def test_no_local_hides_an_imported_module(self):
        files = sorted(KIT.glob('*.py')) + sorted((KIT / 'editor').glob('*.py'))
        problems = [p for f in files for p in shadowed(f)]
        self.assertEqual(problems, [])


if __name__ == '__main__':
    unittest.main()
