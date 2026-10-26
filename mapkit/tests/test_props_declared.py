"""The class that declares each field of the Properties (editor/props.py fields_for declared): one name declared in
two classes apart is two properties (an ATM's accounts are not a computer's), a lamp's sound and a crate's are one
(Actor's). Copy and paste of properties keep them apart by it (static/prop-sets.js)."""
import sys, unittest
from pathlib import Path
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
sys.path[:0] = [str(HERE.parent / 'editor'), str(HERE.parent)]
import props

COMPUTER_USER = '(UserName="",Password="",accessLevel=AL_Untrained)'
ATM_USER = '(accountNumber="",PIN="",balance=0)'
DECO = ['DeusExDecoration', 'Decoration', 'Actor', 'Object']
SOUND = {'AmbientSound': ['None'], 'SoundRadius': ['32'], 'SoundVolume': ['128']}
GAME = {'classes': {
    'Actor': {'parents': ['Object'], 'props': dict(SOUND, Tag=['None']), 'types': {}},
    'DeusExDecoration': {'parents': DECO[1:], 'props': dict(SOUND, Tag=['None']), 'types': {}},
    'ElectronicDevices': {'parents': DECO, 'props': dict(SOUND, Tag=['None']), 'types': {}},
    'Computers': {'parents': ['ElectronicDevices'] + DECO, 'props': dict(SOUND, Tag=['None'], userList=[COMPUTER_USER] * 8), 'types': {}},
    'ComputerPersonal': {'parents': ['Computers', 'ElectronicDevices'] + DECO, 'props': dict(SOUND, Tag=['None'], userList=[COMPUTER_USER] * 8), 'types': {}},
    'ATM': {'parents': ['ElectronicDevices'] + DECO, 'props': dict(SOUND, Tag=['None'], userList=[ATM_USER] * 8), 'types': {}},
    'Light': {'parents': ['Actor', 'Object'], 'props': dict(SOUND, Tag=['None'], LightBrightness=['64']), 'types': {}},
    # an editor class (its parent Trigger not in these defaults): a field only the editor's defaults have is declared
    # by the class FIELDS gives it
    'UCTriggerBox': {'parents': ['Trigger', 'Actor', 'Object'], 'props': {'Tag': ['None']}, 'types': {}},
}, 'enums': {}}


def declared(cls):
    with patch.object(props, 'defaults', return_value=GAME):
        return {f['prop']: f['declared'] for f in props.fields_for(cls)}


class DeclaredTests(unittest.TestCase):
    def test_accounts_of_a_computer_and_of_an_atm_are_two_properties(self):
        self.assertEqual(declared('ComputerPersonal')['userList'], 'Computers')
        self.assertEqual(declared('ATM')['userList'], 'ATM')

    def test_a_property_of_actor_is_one_on_every_class(self):
        for cls in ('ComputerPersonal', 'ATM', 'Light'):
            d = declared(cls)
            self.assertEqual((d['Tag'], d['AmbientSound'], d['SoundRadius']), ('Actor', 'Actor', 'Actor'), cls)
        self.assertEqual(declared('Light')['LightBrightness'], 'Light')    # its class is the first that has it here

    def test_an_editor_default_is_declared_by_its_field_class(self):
        d = declared('UCTriggerBox')
        self.assertEqual(d['bCylinder'], 'UCTriggerBox')                  # not in the game's defaults: EDITOR_DEFAULTS
        self.assertEqual(d['Tag'], 'Actor')


if __name__ == '__main__':
    unittest.main()
