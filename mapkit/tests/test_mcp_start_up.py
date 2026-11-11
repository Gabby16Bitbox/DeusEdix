"""The start-ups' tidy (review #14, game test defect 5, 29 Oct 2026). The editor's worker (editor/server.py main) and the
mapkit MCP (mcp_server.py's __main__ block) do the same with no game running: what a launch whose game no editor saw
close left in the game goes (live.tidy_cut_short), then the SavePath a Play of DeusEdix 0.1.58 or older cut short left
is the player's own again (project_game.deactivate_if_current; the editor's restore_cut_short_play). Each in a try of its
own; a failure is only logged, in the same words by both (live.TIDY_FAILED, project_game.RESTORE_FAILED; the MCP's on
stderr: stdout carries its protocol), and the server still starts. Run on their own (AST) with stand-ins."""
import ast
import contextlib
import io
import sys
import types
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

KIT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(KIT))
import live  # noqa: E402  (its words: TIDY_FAILED)
import project_game  # noqa: E402  (its words: RESTORE_FAILED)

MCP = KIT / 'mcp_server.py'
SERVER = KIT / 'editor' / 'server.py'


def tree(path):
    return ast.parse(path.read_text(encoding='utf-8-sig'))


def run(nodes, namespace, modules):
    """`nodes` of a module run with these globals and stand-in modules: (stdout, stderr)."""
    out, err = io.StringIO(), io.StringIO()
    with patch.dict(sys.modules, modules), contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
        exec(compile(ast.Module(body=nodes, type_ignores=[]), 'start-up', 'exec'), namespace)
    return out.getvalue(), err.getvalue()


def stand_ins(tidy=None, restore=None):
    """live and project_game with the real ones' words, their start-up calls Mocks (raising `tidy`, `restore`)."""
    return (types.SimpleNamespace(tidy_cut_short=Mock(return_value=[], side_effect=tidy), TIDY_FAILED=live.TIDY_FAILED,
                                  stop=Mock(), remove_launch_inis=Mock()),
            types.SimpleNamespace(deactivate_if_current=Mock(return_value=False, side_effect=restore),
                                  RESTORE_FAILED=project_game.RESTORE_FAILED))


def mcp_start_up(game_running, fake_live, fake_project_game):
    """The __main__ block of mcp_server.py with these stand-ins: (the MCP server, its stdout, its stderr)."""
    block = next(node for node in tree(MCP).body if isinstance(node, ast.If) and '__main__' in ast.unparse(node.test))
    mcp = Mock()
    out, err = run(block.body, {'_game_running': lambda: game_running, 'mcp': mcp, 'sys': sys},
                   {'live': fake_live, 'project_game': fake_project_game})
    return mcp, out, err


def editor_start_up(fake_live, fake_project_game):
    """The start-up block of editor/server.py main() (a worker, no game running), with its restore_cut_short_play as it
    is: (a Mock of its other steps, its stdout)."""
    functions = {node.name: node for node in tree(SERVER).body if isinstance(node, ast.FunctionDef)}
    block = next(node for node in ast.walk(functions['main'])
                 if isinstance(node, ast.If) and 'not game_running()' in ast.unparse(node.test))
    steps = Mock()
    namespace = {'project_server': types.SimpleNamespace(WORKER=True), 'game_running': lambda: False,
                 'live': fake_live, 'play_preview': steps, 'settings': types.SimpleNamespace(MANAGED_PROJECT=False)}
    run([functions['restore_cut_short_play']], namespace, {})
    out, _ = run([block], namespace, {'project_game': fake_project_game})
    return steps, out


class StartUpTests(unittest.TestCase):
    def test_with_no_game_running_the_mcp_tidies_and_restores_before_it_serves(self):
        fake_live, fake_project_game = stand_ins()
        mcp, out, err = mcp_start_up(False, fake_live, fake_project_game)
        fake_live.tidy_cut_short.assert_called_once_with()
        fake_project_game.deactivate_if_current.assert_called_once_with()
        mcp.run.assert_called_once_with()
        self.assertEqual((out, err), ('', ''))

    def test_a_game_running_is_left_alone(self):
        fake_live, fake_project_game = stand_ins()
        mcp, out, _ = mcp_start_up(True, fake_live, fake_project_game)
        fake_live.tidy_cut_short.assert_not_called()
        fake_project_game.deactivate_if_current.assert_not_called()
        mcp.run.assert_called_once_with()
        self.assertEqual(out, '')

    def test_each_failure_is_only_logged_on_stderr_and_the_other_still_runs(self):
        for tidy, restore in ((OSError('UCConsole.txt is in use'), None), (None, RuntimeError('Revision.ini changed'))):
            with self.subTest(tidy=tidy, restore=restore):
                fake_live, fake_project_game = stand_ins(tidy, restore)
                mcp, out, err = mcp_start_up(False, fake_live, fake_project_game)
                fake_live.tidy_cut_short.assert_called_once_with()
                fake_project_game.deactivate_if_current.assert_called_once_with()
                mcp.run.assert_called_once_with()
                self.assertEqual(out, '')
                said = live.TIDY_FAILED % tidy if tidy else project_game.RESTORE_FAILED % restore
                self.assertEqual(err, said + '\n')

    def test_the_editors_start_up_tidies_in_a_try_of_its_own_in_the_same_words(self):
        """The worker's start-up calls tidy_cut_short itself (no longer live.stop(), which tidied as a side effect), and
        a failure of it is only logged, in the MCP's words, before the rest of the start-up runs."""
        fake_live, fake_project_game = stand_ins(tidy=OSError('UCConsole.txt is in use'))
        steps, out = editor_start_up(fake_live, fake_project_game)
        fake_live.tidy_cut_short.assert_called_once_with()
        fake_live.stop.assert_not_called()
        steps.restore.assert_called_once_with()
        fake_project_game.deactivate_if_current.assert_called_once_with()
        _, _, err = mcp_start_up(False, *stand_ins(tidy=OSError('UCConsole.txt is in use')))
        self.assertEqual(out, err)

    def test_both_start_ups_say_a_failed_restore_the_same_way(self):
        _, out = editor_start_up(*stand_ins(restore=RuntimeError('Revision.ini changed')))
        _, _, err = mcp_start_up(False, *stand_ins(restore=RuntimeError('Revision.ini changed')))
        self.assertEqual(out, err)
        self.assertEqual(out, project_game.RESTORE_FAILED % RuntimeError('Revision.ini changed') + '\n')


if __name__ == '__main__':
    unittest.main()
