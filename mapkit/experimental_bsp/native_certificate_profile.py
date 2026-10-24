"""Read-only binding of native certificate dumps to the verified x87 profile."""
import re, hashlib
from certificate_evidence import parse_certificate_bytes
from stratified_csg import verify_profile
import selected_rebuild as base


def control(session):
    output = session.cmd('UC_CERT_PROFILE')
    matches = re.findall(r'^UCMapKit\|certificate profile\|x87_control=0x([0-9a-f]{4})$', output, re.M)
    if len(matches) != 1:
        raise base.Refused('Missing unambiguous native arithmetic profile')
    return int(matches[0], 16)


def dump(session, tag, *, include_zone_pool=False, include_vertex_pool=False):
    if not re.fullmatch('[a-z][a-z0-9-]*', tag):
        raise base.Refused('Invalid certificate tag')
    engine = session.folder/'System/Engine.dll'
    editor = session.folder/'System/Editor.dll'
    profile = dict(engine_sha256=base.sha(engine), editor_sha256=base.sha(editor), control_word_before=control(session))
    session.cmd('UC_CERT_DUMP ..\\Output\\'+tag+'.cert')
    if include_zone_pool:
        session.cmd('UC_CERT_ZONE_POOL ..\\Output\\'+tag+'.zones')
        profile['zone_pool_sha256'] = base.sha(session.folder/'Output'/(tag+'.zones'))
    if include_vertex_pool:
        session.cmd('UC_CERT_VERTEX_POOL ..\\Output\\'+tag+'.verts')
        profile['vertex_pool_sha256'] = base.sha(session.folder/'Output'/(tag+'.verts'))
    profile['control_word_after'] = control(session)
    if base.sha(engine) != profile['engine_sha256']:
        raise base.Refused('Engine changed during certificate dump')
    if base.sha(editor) != profile['editor_sha256']:
        raise base.Refused('Editor changed during certificate dump')
    profile['validation'] = verify_profile(profile)
    path = session.folder/'Output'/(tag+'.cert')
    payload = path.read_bytes()
    return parse_certificate_bytes(payload), dict(profile, certificate_sha256=hashlib.sha256(payload).hexdigest())
