"""Autosave writes drafts without invoking the compiler or changing voice assets."""
import json
import unittest

import test_tutorial_routes as routes

SCRIPT = routes.SCRIPT


class AutosaveRouteTests(unittest.TestCase):
    request = routes.TutorialRouteTests.request

    def setUp(self):
        routes.TutorialRouteTests.setUp(self)

    def test_map_autosave_writes_the_draft_without_initializing_runtime(self):
        draft = {'moved': {'Crate0': {'loc': [1, 2, 3]}}, 'added': []}
        code, result = self.request('/api/edits?script=my_room&automatic=1', draft)
        self.assertEqual(code, 200, result)
        self.assertEqual(json.loads(self.edits.write_text.call_args.args[0]), draft)
        self.project.ensure_runtime.assert_not_called()
        self.workspace.build.assert_not_called()
        self.workspace.install.assert_not_called()

    def test_story_autosave_preserves_text_and_voice_references_without_repacking(self):
        draft = {'dialogues': [{'id': 'd1', 'steps': [{'type': 'line', 'text': 'Edited line', 'voice': 'old_voice'}]}]}
        code, result = self.request('/api/story?script=my_room&automatic=1', draft)
        self.assertEqual(code, 200, result)
        self.story.save.assert_called_once_with('01_MyRoom', draft)
        self.assertIsNone(result['voices'])
        self.namespace['sounds'].rekey.assert_not_called()
        self.project.ensure_runtime.assert_not_called()
        self.workspace.build.assert_not_called()
        self.workspace.install.assert_not_called()

    def test_manual_story_save_retains_existing_voice_processing(self):
        code, result = self.request('/api/story?script=my_room', {'dialogues': []})
        self.assertEqual(code, 200, result)
        self.project.ensure_runtime.assert_called_once()
        self.namespace['sounds'].rekey.assert_called_once()
        self.assertEqual(result['voices'], [])

    def test_tutorial_never_accepts_autosave_even_with_a_valid_token(self):
        for path in ('edits', 'story'):
            with self.subTest(path=path):
                code, result = self.request(f'/api/{path}?script={SCRIPT}&automatic=1', {}, token='session-A')
                self.assertEqual(code, 409, result)
        self.edits.write_text.assert_not_called()
        self.story.save.assert_not_called()
        self.project.ensure_runtime.assert_not_called()

    def test_same_named_user_map_is_saved_normally(self):
        self.session.enabled = False
        code, result = self.request(f'/api/edits?script={SCRIPT}&automatic=1', {'added': []})
        self.assertEqual(code, 200, result)
        self.edits.write_text.assert_called_once()

    def test_autosave_can_write_drafts_while_the_game_uses_the_previous_build(self):
        self.game = True
        for path in ('edits', 'story'):
            code, result = self.request(f'/api/{path}?script=my_room&automatic=1', {})
            self.assertEqual(code, 200, result)
        self.workspace.build.assert_not_called()
        self.workspace.install.assert_not_called()
        self.namespace['sounds'].rekey.assert_not_called()

    def test_closed_project_rejects_autosave_before_any_write(self):
        self.project.authorized.return_value = False
        code, _ = self.request('/api/edits?script=my_room&automatic=1', {})
        self.assertEqual(code, 409)
        self.edits.write_text.assert_not_called()


if __name__ == '__main__':
    unittest.main()
