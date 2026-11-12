"""Native NanoKey configuration shared by rules, Story and their MCP inputs."""
import re


def is_nanokey(value):
    return str(value or '').strip().lower() in ('deusex.nanokey', 'nanokey')


def configured(value):
    key_id = str(value.get('keyId') if value.get('keyId') is not None else '').strip()
    if not re.fullmatch(r'[A-Za-z0-9_]{1,63}', key_id) or key_id.lower() == 'none':
        raise ValueError('NanoKey needs a Key ID matching the door, e.g. 2 or ApartmentDoor '
                         '(1-63 letters, digits or underscores; None is not a key).')
    description = str(value.get('keyDescription') or '').strip() or ('Key ' + key_id)
    if len(description) > 160:
        raise ValueError('NanoKey description must be 160 characters or fewer.')
    return key_id, description
