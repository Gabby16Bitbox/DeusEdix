"""The desktop app's bridge to the Game panel (deusedix.py's Api, pywebview's js_api): the page's game_cover goes to
NativeGamePanel.cover, which keeps the editor's window above every other window while an embedded Play starts.

    .venv/Scripts/python.exe -m unittest discover -s launcher -p "test_*.py"
"""
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parent))
import deusedix                                                     # noqa: E402


class GamePanelBridgeTests(unittest.TestCase):
    def test_the_page_asks_the_panel_for_the_cover_and_gets_its_answer(self):
        api, asked = deusedix.Api(), []
        api._game_panel = SimpleNamespace(cover=lambda on: asked.append(on) or dict(covered=on, error=''))
        self.assertEqual((api.game_cover(True), api.game_cover(False)),
                         (dict(covered=True, error=''), dict(covered=False, error='')))
        self.assertEqual(asked, [True, False])

    def test_continue_in_game_window_asks_the_panel_to_bring_the_game_to_the_front(self):
        # review su3 #5 (31 Oct 2026): the page's game_detach(true) is Continue in game window's; with no argument it
        # is every other detach's (Stop's hand-back, the Game view left, an error)
        api, asked = deusedix.Api(), []
        api._game_panel = SimpleNamespace(detach=lambda front=False: asked.append(front) or dict(attached=False))
        self.assertEqual((api.game_detach(), api.game_detach(True)), (dict(attached=False), dict(attached=False)))
        self.assertEqual(asked, [False, True])


if __name__ == '__main__':
    unittest.main()
