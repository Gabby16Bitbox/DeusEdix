"""Optional double-precision geometry UV preparation on DirectCompute.

This prepares the editor's mesh, never replaces the game's CSG/BSP compiler.
No CUDA/Python packages are required. Hardware/double support is checked by the
helper; failed or unsuitable GPU work falls back to native CPU, then Python.
Auto mode measures CPU and GPU (including transfers) on the first large batch
of each size class. Explicit gpu/cpu/verify modes are for benchmarks.
"""
from array import array
import ctypes
import math
import os
from pathlib import Path
import threading
import time

_library = None
_attempted = False
_load_lock = threading.Lock()
_choice_lock = threading.Lock()
_choices = {}
_local = threading.local()
MIN_GPU_VERTICES = 131072
MAX_VERTICES = 2000000
MAX_POLYGONS = 500000
_DOUBLE = ctypes.POINTER(ctypes.c_double)


def _load():
    global _library, _attempted
    with _load_lock:
        if _attempted:
            return _library
        _attempted = True
        if os.name != 'nt' or ctypes.sizeof(ctypes.c_void_p) != 8:
            return None
        path = Path(__file__).resolve().parent.parent / 'bin' / 'DeusEdixGeometry.dll'
        try:
            lib = ctypes.CDLL(str(path))
            lib.dg_version.argtypes = []
            lib.dg_version.restype = ctypes.c_int
            if lib.dg_version() != 1:
                return None
            lib.dg_adapter.argtypes = [ctypes.c_void_p, ctypes.c_uint32]
            lib.dg_adapter.restype = ctypes.c_int
            lib.dg_map.argtypes = [_DOUBLE, ctypes.c_uint32, _DOUBLE, ctypes.c_uint32, _DOUBLE, ctypes.c_int]
            lib.dg_map.restype = ctypes.c_int
            _library = lib
        except (OSError, AttributeError):
            pass
        return _library


def status():
    """Hardware availability, not proof a given batch ran on the GPU."""
    lib = _load()
    if lib is None:
        return dict(available=False, reason='Optional native helper unavailable')
    name = ctypes.create_string_buffer(256)
    ok = lib.dg_adapter(name, len(name)) == 1
    return dict(available=ok, adapter=name.value.decode('utf-8', errors='replace'))


def last_run():
    return dict(getattr(_local, 'report', {}))


def _call(lib, vertices, params, gpu):
    count = len(vertices)//4
    result = array('d', [0.0]) * (count*4)
    vs = (ctypes.c_double * len(vertices)).from_buffer(vertices)
    ps = (ctypes.c_double * len(params)).from_buffer(params)
    rs = (ctypes.c_double * len(result)).from_buffer(result)
    start = time.perf_counter()
    code = lib.dg_map(vs, count, ps, len(params)//24, rs, int(gpu))
    seconds = time.perf_counter()-start
    if code < 0 or (gpu and code != 1) or any(not math.isfinite(x) for x in result):
        return None, seconds
    return result, seconds


def _rounded_equal(a, b):
    # The serialized editor mesh retains 4 decimal places for UV, 5 for light UV.
    return all(round(x, 4 if i%4 < 2 else 5) == round(y, 4 if i%4 < 2 else 5)
               for i, (x, y) in enumerate(zip(a, b)))


def packed(vertices, params, mode='auto'):
    """Return flat uv,uv2 values or None for the original Python implementation."""
    if mode not in ('auto', 'cpu', 'gpu', 'verify', 'python'):
        mode = 'auto'
    count = len(vertices)//4
    _local.report = dict(requested=mode, backend='python', vertices=count)
    if mode == 'python' or not count or len(vertices)%4 or len(params)%24 or not params:
        return None
    if count > MAX_VERTICES or len(params)//24 > MAX_POLYGONS:
        _local.report['reason'] = 'Batch exceeds resource budget'
        return None
    lib = _load()
    if lib is None:
        return None
    bucket = count.bit_length()
    with _choice_lock:
        choice = _choices.get(bucket)
    probe = mode == 'verify' or (mode == 'auto' and count >= MIN_GPU_VERTICES and choice is None)
    want_gpu = mode in ('gpu', 'verify') or (mode == 'auto' and count >= MIN_GPU_VERTICES and choice is not False)
    gpu_result, gpu_seconds = _call(lib, vertices, params, True) if want_gpu else (None, 0.0)
    if probe or gpu_result is None:
        cpu_result, cpu_seconds = _call(lib, vertices, params, False)
        equal = gpu_result is not None and cpu_result is not None and _rounded_equal(gpu_result, cpu_result)
        if probe:
            use_gpu = equal and gpu_seconds < cpu_seconds*0.9
            with _choice_lock:
                _choices[bucket] = use_gpu
            _local.report.update(cpu_seconds=cpu_seconds, gpu_seconds=gpu_seconds, matched=equal)
            if mode == 'verify' and equal:
                _local.report['backend'] = 'gpu'
                return gpu_result
            if mode == 'auto' and use_gpu:
                _local.report['backend'] = 'gpu'
                return gpu_result
        if want_gpu and gpu_result is None:
            _local.report['reason'] = 'GPU unavailable or failed; used CPU'
            if mode == 'auto':
                with _choice_lock:
                    _choices[bucket] = False
        _local.report.update(backend='cpu' if cpu_result is not None else 'python', cpu_seconds=cpu_seconds)
        return cpu_result
    _local.report.update(backend='gpu', gpu_seconds=gpu_seconds)
    return gpu_result


def prepare(polys, lightmap, surfaces, mode=None):
    """(flat result, per-polygon vertex offsets), or None. Original data untouched."""
    mode = mode or os.environ.get('DEUSEDIX_GEOMETRY_COMPUTE', 'auto').lower()
    if mode == 'python':
        _local.report = dict(requested=mode, backend='python')
        return None
    count = sum(len(p[3])//3 for p in polys)
    if mode == 'auto' and count < MIN_GPU_VERTICES:
        _local.report = dict(requested=mode, backend='python', vertices=count, reason='Small batch; avoid packing and transfers')
        return None
    if len(polys) > MAX_POLYGONS or count > MAX_VERTICES:
        return None
    if _load() is None:
        _local.report = dict(requested=mode, backend='python', vertices=count, reason='Optional helper unavailable')
        return None
    vertices, params, offsets = array('d'), array('d'), []
    aw, ah = lightmap['size'] if lightmap else (1, 1)
    for i, (_, _, numbers, points, _) in enumerate(polys):
        if len(numbers) != 13 or len(points)%3:
            return None
        offsets.append(len(vertices)//4)
        for j in range(0, len(points), 3):
            vertices.extend((points[j], points[j+1], points[j+2], i))
        nums = list(numbers)
        nums[11], nums[12] = nums[11] or 128, nums[12] or 128
        rect = lightmap['surfs'].get(str(surfaces[i])) if lightmap and i < len(surfaces) else None
        if rect and len(rect) != 8:
            return None
        params.extend(nums + list(rect or (0, 0, 1, 1, 0, 0, 1, 1)) + [aw, ah, 1 if rect else 0])
    result = packed(vertices, params, mode)
    return (result, offsets) if result is not None else None
