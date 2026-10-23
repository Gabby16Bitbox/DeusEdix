"""Deny global compilation during an isolated no-Full experiment.

This is an execution constraint, NOT a geometry correctness certificate. Use
only in a dedicated worker interpreter; it temporarily replaces the private
session class, never the shared editor. Full development comparison belongs in
a later session, after the result and its hashes have already been recorded.
"""
from contextlib import contextmanager
from pathlib import Path
import hashlib
import re


class FullExcluded(ValueError):pass


LOCAL_COMMANDS=frozenset('''UC_CERT_DUMP UC_CERT_PROFILE UC_CERT_BOX_UPDATE UC_CERT_RETAIN_UV UC_CERT_ZONE_POOL UC_CERT_VERTEX_POOL UC_CERT_RETAIN_RINGS UC_SELECTED_DUMP
UC_SELECTED_TRACE UC_REGION_SOURCES UC_REGION_UV_SNAPSHOT UC_REGION_PREPARE_PRESERVE
UC_REGION_BUILD UC_REGION_DUMP UC_REGION_CLIP UC_REGION_CLIP_PLANES UC_REGION_CLIP_ORDERED
UC_REGION_GRAFT UC_REGION_GRAFT_DEFER UC_REGION_FINISH UC_REGION_POINT UC_REGION_SCALE
UC_SET UC_NONSOLID_STATE UC_NONSOLID_UPDATE UC_EXTENT_HULLS UC_EXTENT_EVIDENCE'''.split())


def digest(path):return hashlib.sha256(path.read_bytes()).hexdigest()


class SessionAudit:
    def __init__(self,folder):
        self.folder=Path(folder).resolve();self.sources=None;self.commands=[];self.regions=[]

    def private_file(self,token):
        # Native path-taking custom commands use a single whitespace-free token.
        if not token or any(c in token for c in '"\r\n\x00'):raise FullExcluded('Invalid native evidence path')
        path=(self.folder/'System'/token).resolve()
        if not path.is_relative_to(self.folder/'Output'):
            raise FullExcluded('Local recipe/evidence must be inside this session Output')
        return path

    def validate(self,command):
        if not isinstance(command,str) or not command or any(c in command for c in '\r\n\x00'):
            raise FullExcluded('Exactly one nonempty native command is required')
        words=command.split();head=words[0].upper()
        if head=='MAP':
            if len(words)<3 or words[1].upper() not in ('LOAD','SAVE','EXPORT') or not words[2].upper().startswith('FILE='):
                raise FullExcluded('Global MAP command is unavailable in a no-Full session')
            if words[1].upper()=='LOAD':self.sources=None
        elif head not in LOCAL_COMMANDS:
            raise FullExcluded('Command is outside the reviewed no-Full capability set: '+head)
        if head=='UC_CERT_RETAIN_UV':
            if (len(words)!=2 or not re.fullmatch(r'[A-Za-z_]\w*',words[1]) or
                    self.sources is None or words[1] not in self.sources):
                raise FullExcluded('Retained mapping update requires one inventoried source brush')
        if head=='UC_REGION_BUILD':
            if len(words)!=2 or self.sources is None:raise FullExcluded('Source inventory required before regional replay')
            path=self.private_file(words[1]);names=path.read_text().split()
            if not names or len(names)!=len(set(names)) or not set(names)<self.sources:
                raise FullExcluded('Regional replay must use a strict, duplicate-free subset of authoritative sources')
            self.regions.append(dict(path=str(path),sha256=digest(path),contributors=len(names),total_sources=len(self.sources)))
        if head=='UC_REGION_SOURCES':
            if len(words)!=2:raise FullExcluded('Expected one source evidence path')
            self.private_file(words[1])
        if head in ('UC_CERT_ZONE_POOL','UC_CERT_VERTEX_POOL','UC_CERT_RETAIN_RINGS'):
            if len(words)!=2:raise FullExcluded('Expected one private native evidence/recipe path')
            self.private_file(words[1])
        return head

    def completed(self,command):
        words=command.split()
        if words[0].upper()=='MAP' and words[1].upper()=='LOAD':self.sources=None
        if words[0].upper()=='UC_REGION_SOURCES':
            names=[]
            for line in self.private_file(words[1]).read_text().splitlines():
                fields=line.split()
                if fields and fields[0]=='B':
                    if len(fields)<2 or not re.fullmatch(r'[A-Za-z_]\w*',fields[1]):raise FullExcluded('Malformed source identity')
                    names.append(fields[1])
            if not names or len(names)!=len(set(names)):raise FullExcluded('Incomplete source inventory')
            current=set(names)
            if self.sources is not None and self.sources!=current:raise FullExcluded('Source inventory changed during experiment')
            self.sources=current
        self.commands.append(command)

    def report(self):
        return dict(full_commands_excluded=True,commands=list(self.commands),regions=list(self.regions),
                    scope='Command exclusion and strict regional source subsets only; not a geometry certificate')


@contextmanager
def guarded_sessions(base):
    """Instrument sessions opened by base.open_map, restoring the factory always."""
    previous=base.PrivateSession;audits=[]
    if getattr(previous,'full_exclusion_active',False):raise FullExcluded('Nested no-Full session guards are not supported')
    class NoFullSession(previous):
        full_exclusion_active=True
        def __init__(self,*args,**kwargs):
            super().__init__(*args,**kwargs)
            self.no_full_audit=SessionAudit(self.folder);audits.append(self.no_full_audit)
        def batch(self,commands,timeout=3600):
            commands=list(commands)
            # Validate the entire batch before any command reaches the engine.
            # Source inventory batches must be separate from dependent builds.
            for command in commands:self.no_full_audit.validate(command)
            result=super().batch(commands,timeout)
            for command in commands:self.no_full_audit.completed(command)
            return result
    base.PrivateSession=NoFullSession
    try:yield audits
    finally:base.PrivateSession=previous
