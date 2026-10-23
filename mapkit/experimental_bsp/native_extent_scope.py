"""Strict private prototype: certify native extent-hull locality before first hit.

This does not emulate arbitrary hulls or accept a collision because two samples
match. It removes ONLY hulls whose *native mandatory AABB plane* cannot accept
before the original raw first hit; all remaining hull planes, order and bounds
must be identical. Every input comes from a pass-through native trace with the
known Engine.dll and x87 53-bit nearest control. No publication integration yet.
"""
from dataclasses import dataclass
from fractions import Fraction as Q
import hashlib,math,re,struct
from collections import Counter
from source_volume import closed_volume_certificate
from edited_collision_scope import source_edit_certificate

ENGINE_SHA='d66b689bbe95d7350b9f348da2273383c642e22e53dd56bd1bcf76ec322aa848'
_TOKEN=object()
class Refused(ValueError):pass

def round_binary(value,precision):
    """Correct ties-to-even for finite normal numbers in our bounded domain."""
    x=Q(value)
    if not x:return x
    sign=-1 if x<0 else 1;x=abs(x)
    exponent=x.numerator.bit_length()-x.denominator.bit_length()
    if x<Q(2)**exponent:exponent-=1
    shift=exponent-precision+1;step=Q(2)**shift
    q,r=divmod(x/step,1);integer=int(q)
    if r>Q(1,2) or r==Q(1,2) and integer&1:integer+=1
    return sign*integer*step

def f32(value):
    x=Q(value)
    if x and not Q(2)**-100<=abs(x)<=Q(2)**100:raise Refused('Unsupported float exponent')
    return round_binary(x,24)

def bits_value(text):
    if not re.fullmatch('[0-9a-f]{8}',text):raise Refused('Malformed native bits')
    value=struct.unpack('<f',struct.pack('<I',int(text,16)))[0]
    if not math.isfinite(value):raise Refused('Non-finite native float')
    return Q(value)

def _numbers(text,count):
    words=text.split()
    if len(words)!=count:raise Refused('Incomplete native numbers')
    try:return tuple(f32(float(v)) for v in words)
    except (ValueError,OverflowError):raise Refused('Malformed native numbers')

@dataclass(frozen=True)
class Hull:
    planes:tuple
    bounds:tuple
    bits:tuple

@dataclass(frozen=True)
class Evidence:
    _token:object
    engine_sha:str
    probe:tuple
    native_inputs:tuple
    hulls:tuple
    raw_first_hit:Q
    winner:int
    result:tuple

@dataclass(frozen=True)
class ModelEvidence:
    _token:object
    engine_sha:str
    hulls:tuple
    references:tuple

def parse_model_evidence(output,engine_path):
    if hashlib.sha256(engine_path.read_bytes()).hexdigest()!=ENGINE_SHA:raise Refused('Unknown native implementation')
    hulls=[];references=[];ids=set();ack=[]
    for line in output.splitlines():
        p=line.split('|')
        if p[:2]==['UCMapKit','selected hull complete']:
            if len(p)!=4 or p[2]!='ALL':raise Refused('Not the complete model hull inventory')
            ack.append(int(p[3]))
        elif p[:2]==['UCMapKit','selected hull']:
            try:index=int(p[2]);count=int(p[3])
            except (IndexError,ValueError):raise Refused('Malformed model hull count')
            if index<0 or index in ids or not 1<=count<64 or len(p)!=5+count:raise Refused('Incomplete/duplicated model hull')
            ids.add(index);planes=[];bits=[];refs=[]
            for field in p[4:4+count]:
                v=field.split()
                if len(v)!=7 or not re.fullmatch('[A-Za-z_][A-Za-z_0-9]*',v[4]) or not re.fullmatch('-?[0-9]+',v[5]) or v[6]!='0':
                    raise Refused('Malformed global hull provenance')
                plane=tuple(bits_value(w) for w in v[:4])
                if not any(plane[:3]):raise Refused('Zero hull plane')
                planes.append(plane);bits.extend(v[:4]);refs.append((v[4],int(v[5])))
            bound=p[-1].split()
            if len(bound)!=7 or bound[0]!='bounds':raise Refused('Missing model hull bounds')
            bounds=tuple(bits_value(w) for w in bound[1:]);bits.extend(bound[1:])
            if any(bounds[i]>=bounds[i+3] for i in range(3)):raise Refused('Non-volume model hull')
            hulls.append(Hull(tuple(planes),bounds,tuple(bits)));references.append(tuple(refs))
    if ack!=[len(hulls)] or not hulls:raise Refused('Incomplete global hull inventory')
    return ModelEvidence(_TOKEN,ENGINE_SHA,tuple(hulls),tuple(references))

def parse_evidence(output,probe,engine_path):
    if hashlib.sha256(engine_path.read_bytes()).hexdigest()!=ENGINE_SHA:raise Refused('Unknown native implementation')
    if len(probe)!=9:raise Refused('Expected nine probe coordinates')
    probe=tuple(f32(x) for x in probe)
    if any(e<=0 for e in probe[6:]) or sum(a!=b for a,b in zip(probe[:3],probe[3:6]))!=1:
        raise Refused('Requires positive extent and one-axis sweep')
    lines=output.splitlines();hulls=[];inputs=[];accepted=[];pending=False
    controls=[line for line in lines if line.startswith('UCMapKit|extent fp-control|')]
    if controls!=['UCMapKit|extent fp-control|027f','UCMapKit|extent fp-control|027f']:
        raise Refused('Native x87 precision/rounding control not proven pre/post')
    acks=[line for line in lines if line.startswith('UCMapKit|extent passthrough|')]
    if len(acks)!=1 or not re.fullmatch(r'UCMapKit\|extent passthrough\|1\|[1-9][0-9]* accepted\|0 malformed\|restored',acks[0]):
        raise Refused('Native trace changed or hook restoration not proven')
    for line in lines:
        p=line.split('|')
        if p[:2]==['UCMapKit','extent visited']:
            if pending:raise Refused('Missing native hull exit')
            try:count=int(p[3])
            except (IndexError,ValueError):raise Refused('Malformed hull count')
            if not 1<=count<64 or len(p)!=5+count:raise Refused('Incomplete hull')
            planes=tuple(tuple(bits_value(v) for v in word.split()) for word in p[4:4+count])
            if any(len(v)!=4 or not any(v[:3]) for v in planes):raise Refused('Malformed hull plane')
            bounds=p[-1].split()
            if len(bounds)!=7 or bounds[0]!='bounds':raise Refused('Missing hull bounds')
            bounds=tuple(bits_value(v) for v in bounds[1:])
            if any(bounds[i]>=bounds[i+3] for i in range(3)):raise Refused('Non-volume hull bounds')
            rawbits=tuple(word for value in p[4:4+count] for word in value.split())+tuple(p[-1].split()[1:])
            hulls.append(Hull(planes,bounds,rawbits));pending=True
        elif p[:2]==['UCMapKit','extent inputs']:
            if not pending or len(inputs)!=len(hulls)-1:raise Refused('Duplicate/misordered native inputs')
            inputs.append(_numbers(p[2],9))
        elif p[:2]==['UCMapKit','extent accepted']:
            if not pending or len(p)!=10 or not p[-1].startswith('raw '):raise Refused('Missing raw hit bits')
            bits=p[-1].split()
            if len(bits)!=3:raise Refused('Malformed raw hit bits')
            raw,exit=map(bits_value,bits[1:])
            if not 0<raw<exit:raise Refused('Clamped/inside/degenerate native contact')
            accepted.append((raw,len(hulls)-1))
        elif p[:2]==['UCMapKit','extent exit']:
            if not pending or len(inputs)!=len(hulls):raise Refused('Misordered native hull exit')
            pending=False
    expected=probe[6:]+probe[3:6]+probe[:3]
    if pending or not hulls or not accepted or len(inputs)!=len(hulls) or any(v!=expected for v in inputs):
        raise Refused('Incomplete or substituted native path')
    if int(acks[0].split('|')[3].split()[0])!=len(accepted):raise Refused('Incomplete accepted-hit records')
    if any(b[0]>=a[0] for a,b in zip(accepted,accepted[1:])):raise Refused('Native hit order is not strictly earlier')
    finals=[l.split('|')[2] for l in lines if l.startswith('UCMapKit|extent final|')]
    if len(finals)!=1 or finals[0]=='clear':raise Refused('Requires one native first hit')
    result=_numbers(finals[0],7)
    if not 0<result[0]<1:raise Refused('Clamped final hit')
    return Evidence(_TOKEN,ENGINE_SHA,probe,expected,tuple(hulls),accepted[-1][0],accepted[-1][1],result)

def aabb_rejection(bounds,probe,raw_hit):
    """Prove a mandatory native plane cannot enter before raw_hit.

    x87 PC=53 nearest: bounds +/- binary64(.1) -> binary32; PlaneDot ->
    binary32; denominator -> binary32; quotient rounded53 then stored32.
    No inferred epsilon, no generic ULP allowance, no returned hit backoff.
    """
    if len(bounds)!=6 or len(probe)!=9 or not 0<raw_hit<1:raise Refused('Malformed native AABB request')
    bounds=tuple(map(Q,bounds));probe=tuple(map(Q,probe));raw_hit=Q(raw_hit)
    if any(f32(v)!=v for v in bounds+probe) or any(bounds[i]>=bounds[i+3] for i in range(3)):
        raise Refused('AABB/probe is not a native finite volume')
    decimal_tenth=Q(float(.1));out=[]
    for axis in range(3):
        for side,n,w in [('min',-1,f32(round_binary(decimal_tenth-bounds[axis],53))),
                         ('max',1,f32(round_binary(bounds[axis+3]+(decimal_tenth if axis==2 else -decimal_tenth),53)))]:
            support=probe[6+axis]
            start=f32(round_binary(n*probe[axis]-w,53));end=f32(round_binary(n*probe[3+axis]-w,53))
            if start<=support:continue
            delta=f32(round_binary(start-end,53))
            if delta<=Q(float(1e-5)):
                if end>support:out.append(dict(axis=axis,side=side,kind='strict outside both endpoints',margin=float(min(start,end)-support)))
                continue
            numerator=round_binary(start-support,53)
            quotient=round_binary(numerator/delta,53)
            stored=f32(quotient)
            if quotient>raw_hit and stored>raw_hit:
                out.append(dict(axis=axis,side=side,kind='native entry after raw first hit',entry=str(stored),raw_hit=str(raw_hit)))
    return out

def compare_paths(original,local):
    if not all(isinstance(e,Evidence) and e._token is _TOKEN and e.engine_sha==ENGINE_SHA for e in (original,local)):
        raise Refused('Typed verified native evidence required')
    if original.probe!=local.probe or original.native_inputs!=local.native_inputs or original.result!=local.result or original.raw_first_hit!=local.raw_first_hit:
        raise Refused('Actual native contact or inputs changed')
    if original.hulls[original.winner]!=local.hulls[local.winner]:raise Refused('Winning hull changed')
    kept=[];audit=[]
    for evidence in (original,local):
        rows=[];remaining=[]
        for i,hull in enumerate(evidence.hulls):
            checks=aabb_rejection(hull.bounds,evidence.probe,evidence.raw_first_hit)
            if checks:
                if i==evidence.winner:raise Refused('Winning hull incorrectly excluded')
                rows.append(dict(index=i,proof=checks))
            else:remaining.append(hull)
        kept.append(remaining);audit.append(rows)
    if not kept[0] or kept[0]!=kept[1]:raise Refused('Participating native hull/plane order changed')
    return dict(native_paths_equivalent=True,remaining_hulls=len(kept[0]),rejected_hulls=audit,
                source_scope_certified=False,publication_allowed=False,
                limitation='Native path certificate only; source-box scope/representation must also be certified before reference selection.')

def _box(source):
    proof=closed_volume_certificate(source)
    if not proof['valid']:raise Refused('Source volume: '+proof['reason'])
    if source.get('operation')!=1 or source.get('flags',0)&(0x08|0x04000000) or not source.get('flags',0)&0x20:
        raise Refused('Only additive semisolid source boxes')
    faces=source['faces'];normals=source['face_normals']
    if len(faces)!=6 or any(len(face)!=4 for face in faces):raise Refused('Not a six-quad source box')
    pts={tuple(f32(x) for x in p) for face in faces for p in face}
    bounds=tuple(min(p[k] for p in pts) for k in range(3))+tuple(max(p[k] for p in pts) for k in range(3))
    if len(pts)!=8 or any(v not in (bounds[k],bounds[k+3]) for p in pts for k,v in enumerate(p)):
        raise Refused('Source is not an exact axis-aligned box')
    expected={(axis,side) for axis in range(3) for side in (-1,1)};seen=set()
    for face,normal in zip(faces,normals):
        normal=tuple(f32(v) for v in normal);axes=[k for k in range(3) if normal[k]]
        if len(axes)!=1 or abs(normal[axes[0]])!=1:raise Refused('Source normal is not an exact unit axis')
        axis=axes[0];side=int(normal[axis]);plane=bounds[axis+(3 if side==1 else 0)]
        if (axis,side) in seen or any(f32(v[axis])!=plane for v in face):raise Refused('Source box plane mismatch')
        seen.add((axis,side))
    if seen!=expected:raise Refused('Incomplete source box')
    return bounds

def _box_representation(name,bounds,model,axis):
    referenced=[h for h,refs in zip(model.hulls,model.references) if any(actor==name for actor,face in refs)]
    if not referenced:raise Refused('Selected source has no compiled collision hull')
    for h in referenced:
        if len(h.planes)!=6:continue
        limits={};valid=True
        for p in h.planes:
            axes=[k for k in range(3) if p[k]]
            if len(axes)!=1 or abs(p[axes[0]])!=1:valid=False;break
            k=axes[0];side=int(p[k]);key=(k,side)
            if key in limits:valid=False;break
            limits[key]=p[3]/side
        if not valid or len(limits)!=6:continue
        # Only the separating coordinate is needed for this certificate. Other
        # faces remain subject to mandatory Full surface coverage and zone gates.
        if limits[axis,-1]!=bounds[axis] or limits[axis,1]!=bounds[axis+3] or h.bounds[axis]!=bounds[axis] or h.bounds[axis+3]!=bounds[axis+3]:continue
        # Containment, not merely overlap: a tiny surviving slab must not stand
        # in for a missing source collider. Exact source corners suffice for a
        # six-plane convex box; no SDK tolerance is introduced here.
        if all(limits[k,-1]<=bounds[k] and limits[k,1]>=bounds[k+3] and
               h.bounds[k]<=bounds[k] and h.bounds[k+3]>=bounds[k+3] for k in range(3)):
            return len(referenced)
    raise Refused('No compiled source box with exact separating planes/bounds')

def certify(original,local,original_model,local_model,old_sources,new_sources,selected,reference='full'):
    if reference!='full':raise Refused('This may only select Original instead of Full')
    if not all(isinstance(e,ModelEvidence) and e._token is _TOKEN and e.engine_sha==ENGINE_SHA for e in (original_model,local_model)):
        raise Refused('Verified complete native model evidence required')
    dependency=source_edit_certificate(old_sources,new_sources,selected)
    if not dependency['valid']:raise Refused('Uncertified source edit dependencies')
    proof=compare_paths(original,local);source_proofs=[]
    for name in sorted(selected):
        for stage,source,model in [('original',old_sources[name],original_model),('local',new_sources[name],local_model)]:
            bounds=_box(source);checks=aabb_rejection(bounds,original.probe,original.raw_first_hit)
            if not checks:raise Refused('Native source box may participate before first hit')
            representation=None
            for check in checks:
                try:count=_box_representation(name,bounds,model,check['axis'])
                except Refused:continue
                representation=dict(brush=name,stage=stage,referenced_hulls=count,separation=check);break
            if representation is None:raise Refused('Missing exact separating source collision representation')
            source_proofs.append(representation)
    a,b=Counter(original_model.hulls),Counter(local_model.hulls);changes=[]
    for stage,unmatched in [('original',a-b),('local',b-a)]:
        audit=[]
        for hull,count in unmatched.items():
            checks=aabb_rejection(hull.bounds,original.probe,original.raw_first_hit)
            if not checks:raise Refused('A changed global hull can participate before first hit')
            audit.append(dict(multiplicity=count,proof=checks))
        changes.append(dict(stage=stage,changed_hulls=sum(unmatched.values()),disjoint=audit))
    # Every traced hull must belong to the exact model inventory, with its bits.
    for evidence,model in [(original,original_model),(local,local_model)]:
        if any(h not in model.hulls for h in evidence.hulls):raise Refused('Trace/model hull provenance mismatch')
    proof.update(source_scope_certified=True,publication_allowed=False,source_proofs=source_proofs,
                 global_changed_hulls=changes,reference='original',
                 limitation='This certifies these native sweeps only; Full geometry, zones, occupancy, reload and all other gates remain mandatory.')
    return proof
