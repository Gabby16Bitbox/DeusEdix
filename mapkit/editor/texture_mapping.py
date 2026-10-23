"""Texture frames from the engine's cached BSP dump; never rebuild a map."""
from collections import defaultdict
import math


def frame(nums):
    """World origin, normalized U/V covectors, then normalized pan."""
    w, h = nums[11] or 128, nums[12] or 128
    return list(nums[:3]) + [n / w for n in nums[3:6]] + [n / h for n in nums[6:9]] + [nums[9] / w, nums[10] / h]


def enrich(groups, polys):
    """Upgrade old previews in memory. Match both plane and UV, not just texture."""
    candidates = defaultdict(list)
    for tex, _flags, nums, verts, _brush in polys:
        if len(verts) < 9:
            continue
        a = verts[:3]
        for j in range(3, len(verts) - 3, 3):
            b = [verts[j+k] - a[k] for k in range(3)]
            c = [verts[j+3+k] - a[k] for k in range(3)]
            n = [b[1]*c[2]-b[2]*c[1], b[2]*c[0]-b[0]*c[2], b[0]*c[1]-b[1]*c[0]]
            length = math.sqrt(sum(x*x for x in n))
            if length > 1e-8:
                n = [x/length for x in n]
                candidates[tex].append((frame(nums), n, sum(n[k]*a[k] for k in range(3))))
                break
    for group in groups:
        pos, uv = group['pos'], group['uv']
        previous = group.get('uvFrames', [])
        frames = []
        for i in range(0, len(pos), 9):
            found = previous[i//9] if i//9 < len(previous) else None
            if found:
                frames.append(found)
                continue
            for f, normal, distance in candidates[group['tex']]:
                good = True
                for j in range(3):
                    p = pos[i+j*3:i+j*3+3]
                    if abs(sum(normal[k]*p[k] for k in range(3))-distance) > .25:
                        good = False
                        break
                    for axis in range(2):
                        value = sum((p[k]-f[k])*f[3+axis*3+k] for k in range(3))+f[9+axis]
                        if abs(value-uv[(i//3+j)*2+axis]) > .01:
                            good = False
                            break
                    if not good:
                        break
                if good:
                    found = f
                    break
            frames.append(found)
        group['uvFrames'] = frames
    return groups
