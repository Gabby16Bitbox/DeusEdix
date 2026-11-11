"""The compiled form of a map's level logic (editor/LOGIC.md): what the game gets from the map's edits, as the page's
Logic simulator (static/logic-sim.js, "Try it") runs it. links.py builds it, as for the Rebuild; nothing here
derives it again, so the simulator and the game run the same data.

    compiled(edits)
        {'actors': links.blocks(edits): the UCLink, UCLinkGroup, UCUsable and UCObjectTag actors the game gets
                   ({'cls', 'name', 'loc', 'props'}, the props as the T3D writes them), and the map's UCLogicHub
                   (links.hub: its start values) when it has one,
         'outputs': {when: {'hears', 'tag'}}: how the game hears each output, and the Tag a link of it waits for
                    ({src}: the object, {option}: a computer's option; '' when it is watched or set off directly),
         'left': [{'id', 'src', 'why', 'text'}]: the rules of the edits that are not in the game, and why (LEFT),
         'error': '' or what stops the build (the Rebuild stops on it too: links.blocks names the rule)}

The page asks for it with the edits it has (saved or not): /api/logic/compile (phase B of the Logic design).
"""
import activation
import links
import logic_catalog
import settings

# Why a rule of the edits is not among the game's actors (links.blocks leaves it out), in the order left_out asks
LEFT = {
    'unfinished': 'it has no object or no action',
    'deleted': 'its object is deleted',
    'disabled': 'its object is disabled',
    'noobject': 'no object is chosen for the character to use',
    'noaction': 'every action of it is on a deleted or disabled object',
}


def outputs():
    """How the game hears each output and the Tag its link waits for: the catalogue's (config/logic.json)."""
    return {when: {'hears': entry['hears'], 'tag': entry.get('tag', '')} for when, entry in logic_catalog.OUTPUTS.items()}


def built_rules(actors):
    """The ids of the rules among the compiled actors (a UCLink's Rule: an id is letters, digits, underscores)."""
    return [a['props']['Rule'].strip('"') for a in actors if a['cls'] in ('UCLink', 'UCRule') and 'Rule' in a['props']]


def built_whole(edits, link):
    """Whether links.blocks builds this one rule when no object of the map is deleted or disabled. When it does not,
    it left the rule's actions out as unfinished (a character to use an object not chosen yet), not for the objects
    taken out of the map. links.blocks itself judges, so its test of an action is not written twice."""
    try:
        return bool(built_rules(links.blocks(dict(edits, links=[link], deleted={}, disabled={}))))
    except ValueError:          # what it now keeps is too much (more than 24 actions) or wrong: it kept some
        return True


def left_out(edits, actors):
    """The rules of the edits that links.blocks did not build: [{'id', 'src', 'why', 'text'}], why a key of LEFT and
    text its sentence."""
    built = set(built_rules(actors))
    deleted, disabled = set(edits.get('deleted') or {}), activation.names(edits)
    out = []
    for link in edits.get('links') or []:
        rule = str(link.get('id') or '').strip()
        if rule in built:
            continue
        src = link.get('src')
        why = ('unfinished' if not links.valid(link) else 'deleted' if src in deleted
               else 'disabled' if src in disabled else 'noobject' if not built_whole(edits, link) else 'noaction')
        out.append(dict(id=rule, src=str(src or ''), why=why, text=LEFT[why]))
    return out


def compiled(edits):
    """The map's logic as the game gets it (see the module's docstring). A build error is returned, not raised: the
    simulator says what stops the Rebuild."""
    try:
        actors = links.blocks(edits)
    except ValueError as exc:
        return dict(actors=[], outputs=outputs(), left=[], error=str(exc))
    left = left_out(edits, actors)
    hub = links.hub(edits) if settings.STANDALONE else None     # the start values Try it applies as the game does
    return dict(actors=actors + ([hub] if hub else []), outputs=outputs(), left=left, error='')
