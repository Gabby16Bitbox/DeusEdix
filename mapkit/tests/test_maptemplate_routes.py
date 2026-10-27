"""The map templates' routes in server.py, on the real handler: Save map as template checks the kept edits as a
save does and refuses what cannot be one, New map's list needs no game runtime, a template is deleted, and New map
makes a map from one with the server's own build."""
import sys
import types
import unittest
from pathlib import Path
from unittest.mock import Mock

KIT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(KIT / 'editor'), str(KIT), str(Path(__file__).resolve().parent)]
import test_tutorial_routes as routes

TEMPLATE = {'id': '20261026-101500-Warm_room', 'name': 'Warm room', 'description': '', 'source': '01_MyRoom', 'room': None, 'picture': ''}


class MapTemplateRouteTests(unittest.TestCase):
    request = routes.TutorialRouteTests.request

    def setUp(self):
        routes.TutorialRouteTests.setUp(self)
        self.templates = types.SimpleNamespace(
            listing=Mock(return_value=[TEMPLATE]), save=Mock(return_value=TEMPLATE), delete=Mock(),
            create=Mock(return_value=('new_02_fresh', '02_Fresh', True, ['made from the template Warm room'])))
        self.namespace['maptemplates'] = self.templates
        self.namespace['map_source'] = lambda script: Path('maps') / (script + '.py')

    def test_save_keeps_the_map_with_the_checks_of_a_save(self):
        body = {'script': 'my_room', 'name': 'Warm room', 'description': 'd', 'picture': 'data:image/jpeg;base64,/9j/', 'edits': {'added': []}}
        code, result = self.request('/api/map_template', body)
        self.assertEqual(code, 200, result)
        self.assertEqual(result, {'template': TEMPLATE, 'templates': [TEMPLATE]})
        args, kwargs = self.templates.save.call_args
        self.assertEqual(args, ('01_MyRoom', Path('maps/my_room.py'), 'Warm room', 'd', 'data:image/jpeg;base64,/9j/', {'added': []}))
        self.assertIs(kwargs['check'], self.namespace['check_edits'])
        self.atomicfile.write_json.assert_not_called()          # the map's own edits are not touched

    def test_what_cannot_be_a_template_is_a_message(self):
        self.templates.save.side_effect = ValueError('This map is made by a map script of its own')
        code, result = self.request('/api/map_template', {'script': 'my_room', 'name': 'x', 'edits': {}})
        self.assertEqual((code, result), (400, {'error': 'This map is made by a map script of its own'}))

    def test_the_list_needs_no_runtime_and_a_template_is_deleted(self):
        code, result = self.request('/api/map_templates', method='GET')
        self.assertEqual((code, result), (200, {'templates': [TEMPLATE]}))
        self.project.ensure_runtime.assert_not_called()
        code, result = self.request('/api/map_template_delete', {'id': TEMPLATE['id']})
        self.assertEqual(code, 200, result)
        self.templates.delete.assert_called_once_with(TEMPLATE['id'])

    def test_new_map_from_a_template_with_the_servers_build(self):
        body = {'from': 'template', 'template': TEMPLATE['id'], 'name': 'Fresh', 'mission': 2, 'location': 'Here'}
        code, result = self.request('/api/newmap', body)
        self.assertEqual(code, 200, result)
        self.assertEqual(result, {'script': 'new_02_fresh', 'map': '02_Fresh', 'ok': True, 'lines': ['made from the template Warm room']})
        args, kwargs = self.templates.create.call_args
        self.assertEqual(args, (TEMPLATE['id'], 'Fresh', 2, 'Here'))
        self.assertIs(kwargs['build'], self.namespace['build'])


if __name__ == '__main__':
    unittest.main()
