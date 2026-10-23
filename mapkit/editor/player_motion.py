"""Fill player-only motions on local copies of installed NPC vertex meshes.

No game geometry is bundled. Keep each body's existing motions and transfer only
the missing player's motion delta, relative to its own corresponding NPC motion.
Local rigid fits preserve the target's shape; this is not a sequence-name alias.
"""
import math
import struct

BASE = {'Walk2H': 'Walk', 'Strafe2H': 'Strafe', 'RunShoot2H': 'RunShoot',
        'BreatheLight2H': 'BreatheLight', 'Shoot2H': 'Shoot', 'CrouchWalk': 'Crouch',
        'Strafe': 'Walk', 'RunShoot': 'Run', 'TreadShoot': 'Tread',
        'CrouchShoot': 'Crouch', 'Shoot': 'BreatheLight', 'Reload': 'BreatheLight',
        'Panic': 'Run', 'SitBreathe': 'Crouch'}
VERSION = 3


def needs_motion(name, target, donor):
    """Some NPCs declare player motions as one-frame placeholders."""
    existing = target.seqs.get(name)
    return existing is None or (existing['frames'] <= 1 and donor.seqs[name]['frames'] > 1)


def base_motion(name, target):
    base = BASE[name]
    while base not in target.seqs and base in BASE: base = BASE[base]
    return base


def sub(a, b):
    return tuple(x-y for x, y in zip(a, b))


def dot(a, b):
    return sum(x*y for x, y in zip(a, b))


def matvec(m, v):
    return tuple(dot(row, v) for row in m)


def rigid_fit(source, dest):
    """Horn absolute orientation; bounded Jacobi eigensolve, no numeric dependency."""
    n = len(source)
    c = tuple(sum(v[i] for v in source)/n for i in range(3))
    d = tuple(sum(v[i] for v in dest)/n for i in range(3))
    s = [[sum((a[i]-c[i])*(b[j]-d[j]) for a, b in zip(source, dest))
          for j in range(3)] for i in range(3)]
    xx, xy, xz = s[0]; yx, yy, yz = s[1]; zx, zy, zz = s[2]
    a = [[xx+yy+zz, yz-zy, zx-xz, xy-yx],
         [yz-zy, xx-yy-zz, xy+yx, zx+xz],
         [zx-xz, xy+yx, -xx+yy-zz, yz+zy],
         [xy-yx, zx+xz, yz+zy, -xx-yy+zz]]
    v = [[float(i == j) for j in range(4)] for i in range(4)]
    for sweep in range(18):
        if sum(a[i][j]**2 for i in range(4) for j in range(i+1, 4)) < 1e-16:
            break
        for p in range(3):
            for q in range(p+1, 4):
                if abs(a[p][q]) < 1e-14: continue
                theta = (a[q][q]-a[p][p])/(2*a[p][q])
                t = (1 if theta >= 0 else -1)/(abs(theta)+math.sqrt(1+theta*theta))
                cs = 1/math.sqrt(1+t*t); sn = t*cs
                for k in range(4):
                    ap, aq = a[k][p], a[k][q]
                    a[k][p], a[k][q] = cs*ap-sn*aq, sn*ap+cs*aq
                for k in range(4):
                    ap, aq = a[p][k], a[q][k]
                    a[p][k], a[q][k] = cs*ap-sn*aq, sn*ap+cs*aq
                    vp, vq = v[k][p], v[k][q]
                    v[k][p], v[k][q] = cs*vp-sn*vq, sn*vp+cs*vq
    k = max(range(4), key=lambda i: a[i][i])
    w, x, y, z = (v[i][k] for i in range(4))
    r = ((1-2*(y*y+z*z), 2*(x*y-z*w), 2*(x*z+y*w)),
         (2*(x*y+z*w), 1-2*(x*x+z*z), 2*(y*z-x*w)),
         (2*(x*z-y*w), 2*(y*z+x*w), 1-2*(x*x+y*y)))
    return r, sub(d, matvec(r, c))


class Mesh:
    def __init__(self, info, data):
        self.info = info
        c = info['counts']; self.count = c['frameVerts']; self.special = c['specialVerts']
        self.seqs = {s['name']: s for s in info['seqs']}
        offset = info['offset']
        faces = list(struct.iter_unpack('<4H', data[offset:offset+c['faces']*8]))
        offset += c['faces']*8
        wedges = [w[0]+self.special for w in struct.iter_unpack('<HBB',data[offset:offset+c['wedges']*4])]
        self.edges = sorted({tuple(sorted((wedges[f[i]],wedges[f[(i+1)%3]])))
                             for f in faces for i in range(3)})
        offset = info['offset'] + c['faces']*8 + c['wedges']*4 + c['specialFaces']*8
        raw = struct.unpack_from('<%dh' % (c['verts']*3), data, offset)
        self.points = []
        scale, origin = info['scale'], info['origin']
        angle = info['rot'][1]*2*math.pi/65536
        cs, sn = math.cos(angle), math.sin(angle)
        if info['rot'][0] or info['rot'][2]:
            raise ValueError('Player animation mesh has unsupported pitch/roll origin.')
        for i in range(0, len(raw), 3):
            x, y, z = ((raw[i+j]-origin[j])*scale[j] for j in range(3))
            self.points.append((x*cs-y*sn, x*sn+y*cs, z))
        still = self.sample('Still', 0)
        self.height = max(v[2] for v in still[self.special:])-min(v[2] for v in still[self.special:])

    def sample(self, sequence, phase, loop=False):
        s = self.seqs[sequence]
        f = phase*(s['frames'] if loop else s['frames']-1)
        a = min(int(f), s['frames']-1); t = f-a
        b = (a+1) % s['frames'] if loop else min(a+1, s['frames']-1)
        a += s['start']; b += s['start']
        return [tuple(x+(y-x)*t for x, y in zip(self.points[a*self.count+i], self.points[b*self.count+i]))
                for i in range(self.count)]

    def encode(self, points):
        angle = -self.info['rot'][1]*2*math.pi/65536
        cs, sn = math.cos(angle), math.sin(angle)
        values = []
        for x, y, z in points:
            xyz = (x*cs-y*sn, x*sn+y*cs, z)
            for i, value in enumerate(xyz):
                raw = round(value/self.info['scale'][i]+self.info['origin'][i])
                if not -32768 <= raw <= 32767:
                    raise ValueError('Player animation exceeds the mesh coordinate range.')
                values.append(raw)
        return struct.pack('<%dh' % len(values), *values)


def generate(target, donor):
    """Return append-only UC_ANIMNEW input and metrics, preserving native sequences."""
    head, binary, report = [], bytearray(), []
    ratio = target.height/donor.height
    # Match once using both rest position and existing motion. Re-selecting nearest
    # points every frame can attach a sleeve to the torso when the arm passes it.
    samples = [(n,p) for n,p in [('Still',0), ('GestureLeft',.5), ('GestureRight',.5),
               ('Run',.3), ('Walk',.7), ('Crouch',1), ('Tread',.25)]
               if n in target.seqs and n in donor.seqs]
    own_samples = [target.sample(n,p) for n,p in samples]
    source_samples = [[tuple(x*ratio for x in v) for v in donor.sample(n,p)] for n,p in samples]
    neighborhoods = []
    for i, point in enumerate(own_samples[0]):
        if i < target.special and donor.special == target.special:
            neighborhoods.append(tuple(range(donor.special))); continue
        distances = [(dot(sub(v,point),sub(v,point)),j)
                     for j,v in enumerate(source_samples[0]) if j >= donor.special]
        candidates = [j for _,j in sorted(distances)[:32]]
        def score(j):
            return sum(dot(sub(src[j],own[i]),sub(src[j],own[i]))
                       for src,own in zip(source_samples,own_samples))
        neighborhoods.append(tuple(sorted(candidates,key=score)[:8]))
    for name in BASE:
        if not needs_motion(name, target, donor): continue
        base = base_motion(name, target)
        if name not in donor.seqs or base not in target.seqs or base not in donor.seqs:
            raise ValueError('Cannot adapt player animation: '+name)
        sequence = donor.seqs[name]
        count = sequence['frames']
        loop = name not in ('Shoot2H', 'Shoot', 'CrouchShoot', 'Reload')
        all_frames = []
        for f in range(count):
            phase = f/(count if loop else max(1, count-1))
            held = base == 'Crouch' or base == 'BreatheLight' and name != 'BreatheLight2H'
            reference_phase = 1.0 if held else phase
            ref = donor.sample(base, reference_phase, loop and not held)
            posed = donor.sample(name, f/max(1, count-1))
            own = target.sample(base, reference_phase, loop and not held)
            ref = [tuple(x*ratio for x in v) for v in ref]
            posed = [tuple(x*ratio for x in v) for v in posed]
            result = []
            fits = {}
            for i, point in enumerate(own):
                indices = neighborhoods[i]
                if indices not in fits:
                    fits[indices] = rigid_fit([ref[j] for j in indices], [posed[j] for j in indices])
                r, t = fits[indices]
                result.append(tuple(x+y for x, y in zip(matvec(r, point), t)))
            # Clothing and limb proportions differ. Project the motion onto the
            # body's own surface constraints, preventing spikes across joints.
            result = preserve_shape(result, own, target.edges)
            all_frames.append(result)
            binary.extend(target.encode(result))
        # Do not append a duplicate sequence name: the engine would keep finding
        # the old one-frame placeholder. The build redirects it to these frames.
        replacement = name in target.seqs
        packed_name = 'UCP_' + name if replacement else name
        head.append('seq %s %s %d %g' % (packed_name, sequence['group'], count, sequence['rate']))
        motion = max(math.dist(a, b) for a, b in zip(all_frames[0], all_frames[-1]))
        report.append(dict(name=name, frames=count, motion=motion, source=base,
                           packed_name=packed_name, replacement=replacement))
    return ('\n'.join(head)+'\ndata\n').encode()+binary, report


def preserve_shape(points, reference, edges):
    points = [list(p) for p in points]
    limits = [(a,b,max(.05,math.dist(reference[a],reference[b]))) for a,b in edges]
    for iteration in range(60):
        worst = 0
        for a,b,length in limits:
            delta = [points[b][i]-points[a][i] for i in range(3)]
            current = math.sqrt(sum(x*x for x in delta))
            if current < 1e-9: continue
            desired = min(length*1.18, max(length*.82,current))
            if desired == current: continue
            worst = max(worst,abs(current-desired))
            correction = (current-desired)/current*.5
            for i in range(3):
                points[a][i] += delta[i]*correction
                points[b][i] -= delta[i]*correction
        if worst < .03: break
    return points
