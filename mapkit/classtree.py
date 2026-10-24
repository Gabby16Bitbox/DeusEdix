"""The class hierarchy of the game, to ask what a class is (a light, a door, a seat) by its parents, not by
its name: 'TrafficLight' is a decoration, 'Beam' is a light, 'BreakableGlass' is a door (a mover).

    tree = ClassTree.from_chains({'Beam': ['Light', 'Actor', 'Object'], ...})    # UC_DEFAULTS / UC_CLASSES
    tree = ClassTree({'Beam': 'Light', 'Light': 'Actor', ...})                     # class -> parent
    tree.is_a('Beam', 'Light')         True
    tree.is_a('OfficeChair', 'Seat')   True
"""


class ClassTree:
    """Every class's parent. A class's line of parents is walked once and kept as a set; a loop in the data (a
    damaged package) ends the walk where a class comes round again."""
    __slots__ = ('_parent', '_line')

    def __init__(self, parents):
        self._parent = dict(parents)
        self._line = {}

    @classmethod
    def from_chains(cls, chains):
        """{class: [parent, grandparent, ..., 'Object']} -> the tree."""
        parent = {}
        for name, chain in chains.items():
            line = [name] + list(chain or ())
            for child, up in zip(line, line[1:]):
                parent.setdefault(child, up)
        return cls(parent)

    def __contains__(self, name):
        return name in self._parent

    def parent(self, name):
        return self._parent.get(name)

    def line(self, name):
        """The class and its parents, nearest first (just the class when it is not in the tree)."""
        return tuple(self._walk(name)[0])

    def is_a(self, name, *bases):
        """True when the class is one of bases or is under one of them."""
        line = self._walk(name)[1]
        return any(b in line for b in bases)

    def kind(self, name):
        """What a map actor of this class is for the map editor (static/app.js draws each kind its own way):
        mover, light, pawn, logic, path or prop. The Character Creator's classes and the helicopters go with the
        characters, as the editor's page has them; a class the tree does not place (one of the map's own, an
        effect) goes by its name, as before the tree."""
        if name.startswith('UCCustom') or 'Helicopter' in name:
            return 'pawn'
        if name in self._parent:
            for kind, bases in KINDS:
                if self.is_a(name, *bases):
                    return kind
        return kind_by_name(name)

    def _walk(self, name):
        known = self._line.get(name)
        if known is None:
            order, seen, c = [], set(), name
            while c is not None and c not in seen:
                order.append(c)
                seen.add(c)
                c = self._parent.get(c)
            known = self._line[name] = (order, frozenset(seen))
        return known


# the kinds by the parents, in this order (a PlayerStart and a Teleporter are navigation points too)
KINDS = (('mover', ('Mover',)), ('light', ('Light',)), ('pawn', ('Pawn', 'PlayerStart')),
         ('logic', ('Teleporter', 'MapExit', 'Triggers', 'Keypoint', 'Info')), ('path', ('NavigationPoint',)),
         ('prop', ('Decoration', 'Inventory', 'Carcass')))


def kind_by_name(name):
    """The kind of a class the tree does not know, from its name."""
    if 'Mover' in name:
        return 'mover'
    if 'Light' in name:
        return 'light'
    if name in ('PathNode', 'PatrolPoint', 'HidePoint', 'AmbushPoint') or name.endswith('Point'):
        return 'path'
    if any(k in name for k in ('Guard', 'Raider', 'Troop', 'PlayerStart', 'Pawn')):
        return 'pawn'
    if any(k in name for k in ('Teleporter', 'MapExit', 'Sound', 'Trigger', 'Event', 'Dispatcher', 'Counter', 'Info',
                               'Flag', 'Spawn', 'Marker', 'Interpolation')):
        return 'logic'
    return 'prop'
