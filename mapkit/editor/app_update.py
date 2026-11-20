"""New versions of DeusEdix from its GitHub releases: the Projects page asks at start (and Help > Check for updates...),
shows what changed in every newer release, and on the user's click downloads the newer installer, checks it against the
SHA-256 published with it, and starts it. The installer itself offers Update and closes DeusEdix (CloseApplications).

Only an installed DeusEdix (deusedix.json with a version) looks for updates; a development copy never does. One request
to GitHub's public API, nothing about the user or their projects in it, at most once an hour per run of DeusEdix."""
import hashlib
import json
import os
import re
import subprocess
import tempfile
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

import settings

REPO = 'Gabby16Bitbox/DeusEdix'
RELEASES = 'https://api.github.com/repos/%s/releases?per_page=30' % REPO
PAGE = 'https://github.com/%s/releases' % REPO
AGENT = 'DeusEdix-update-check'
CACHE_SECONDS = 3600
# the hosts a download may come from: GitHub's release assets (the API's browser_download_url and its redirect)
HOSTS = ('github.com', 'objects.githubusercontent.com', 'release-assets.githubusercontent.com')
MAX_INSTALLER = 400 * 1024 * 1024

_lock = threading.Lock()
_cache = {}                 # 'at', 'releases'
_job = {}                   # the download: state, version, done, total, path, error


def version_tuple(text):
    m = re.fullmatch(r'v?(\d+)\.(\d+)\.(\d+)', str(text or '').strip())
    return tuple(int(x) for x in m.groups()) if m else None


def current_version():
    """The installed DeusEdix's version (deusedix.json at the install folder), or None for a development copy.
    DEUSEDIX_UPDATE_TEST_VERSION pretends one, for testing the check from a development copy."""
    test = os.environ.get('DEUSEDIX_UPDATE_TEST_VERSION')
    if test:
        return test if version_tuple(test) else None
    try:
        value = json.loads((settings.APP_ROOT / 'deusedix.json').read_text(encoding='utf-8')).get('version')
    except (OSError, ValueError, AttributeError):
        return None
    return value if version_tuple(value) else None


def _get(url, timeout=10):
    req = urllib.request.Request(url, headers={'User-Agent': AGENT, 'Accept': 'application/vnd.github+json'})
    with urllib.request.urlopen(req, timeout=timeout) as response:
        return response.read()


def _releases(fresh=False):
    """The published releases that carry an installer, newest first: [{version, tag, name, notes, url, date,
    installer: {name, size, url}, sha256: url or None}]."""
    with _lock:
        if not fresh and _cache.get('releases') is not None and time.monotonic() - _cache['at'] < CACHE_SECONDS:
            return _cache['releases']
    raw = json.loads(_get(RELEASES))
    found = []
    for rel in raw if isinstance(raw, list) else []:
        if not isinstance(rel, dict) or rel.get('draft'):
            continue
        version = version_tuple(rel.get('tag_name'))
        if not version:
            continue
        text = '%d.%d.%d' % version
        assets = {a.get('name'): a for a in rel.get('assets') or [] if isinstance(a, dict)}
        setup = assets.get('DeusEdix-Setup-%s.exe' % text)
        if not setup or not str(setup.get('browser_download_url', '')).startswith('https://github.com/'):
            continue
        digest = assets.get('DeusEdix-Setup-%s.exe.sha256.txt' % text)
        found.append(dict(version=text, tag=rel.get('tag_name'), name=str(rel.get('name') or ''),
                          notes=str(rel.get('body') or ''), url=str(rel.get('html_url') or PAGE),
                          date=str(rel.get('published_at') or ''),
                          installer=dict(name=setup['name'], size=int(setup.get('size') or 0),
                                         url=setup['browser_download_url']),
                          sha256=digest.get('browser_download_url') if digest else None))
    found.sort(key=lambda r: version_tuple(r['version']), reverse=True)
    with _lock:
        _cache.update(at=time.monotonic(), releases=found)
    return found


def check(fresh=False):
    """What the Projects page shows: {current, available, latest, releases: the newer ones with their notes}, or
    {current, available: False, error} when GitHub could not be reached."""
    current = current_version()
    if not current:
        return dict(current=None, available=False, installed=False)
    try:
        releases = _releases(fresh)
    except (OSError, ValueError, urllib.error.URLError) as exc:
        return dict(current=current, available=False, installed=True, page=PAGE,
                    error='GitHub could not be reached (%s).' % (getattr(exc, 'reason', None) or exc))
    newer = [r for r in releases if version_tuple(r['version']) > version_tuple(current)]
    return dict(current=current, installed=True, available=bool(newer), page=PAGE,
                latest=newer[0]['version'] if newer else current,
                releases=[{k: r[k] for k in ('version', 'name', 'notes', 'url', 'date')} | dict(size=r['installer']['size'])
                          for r in newer])


def _folder():
    return Path(tempfile.gettempdir()) / 'DeusEdix-update'


def _download(release):
    url, size = release['installer']['url'], release['installer']['size']
    folder = _folder()
    folder.mkdir(parents=True, exist_ok=True)
    target = folder / release['installer']['name']
    part = target.with_name(target.name + '.part')
    expected = None
    if release.get('sha256'):
        text = _get(release['sha256'], timeout=20).decode('utf-8', 'replace')
        m = re.search(r'\b[0-9a-fA-F]{64}\b', text)
        expected = m.group().lower() if m else None
    req = urllib.request.Request(url, headers={'User-Agent': AGENT})
    digest = hashlib.sha256()
    with urllib.request.urlopen(req, timeout=30) as response:
        host = urllib.request.urlparse(response.geturl()).hostname or ''
        if not any(host == h or host.endswith('.' + h) for h in HOSTS):
            raise RuntimeError('The download was sent to an unexpected host (%s).' % host)
        total = int(response.headers.get('Content-Length') or size or 0)
        if total > MAX_INSTALLER:
            raise RuntimeError('The installer is larger than expected.')
        with _lock:
            _job.update(total=total)
        done = 0
        with open(part, 'wb') as out:
            while True:
                chunk = response.read(256 * 1024)
                if not chunk:
                    break
                done += len(chunk)
                if done > MAX_INSTALLER:
                    raise RuntimeError('The installer is larger than expected.')
                out.write(chunk)
                digest.update(chunk)
                with _lock:
                    _job.update(done=done)
    if size and done != size:
        part.unlink(missing_ok=True)
        raise RuntimeError('The download was incomplete (%d of %d bytes). Try again.' % (done, size))
    if expected and digest.hexdigest() != expected:
        part.unlink(missing_ok=True)
        raise RuntimeError('The downloaded installer does not match the SHA-256 published with it, so it was deleted.')
    os.replace(part, target)
    return target, bool(expected)


def _run_download(release):
    try:
        path, verified = _download(release)
        with _lock:
            _job.update(state='ready', path=str(path), verified=verified)
    except Exception as exc:            # shown in the dialog, which offers the release page instead
        with _lock:
            _job.update(state='error', error=str(exc))


def download(version):
    """Start downloading the installer of `version` (one of the newer releases) in the background."""
    if not current_version():
        raise ValueError('Only an installed DeusEdix can update itself.')
    with _lock:
        if _job.get('state') == 'downloading':
            return status()
    release = next((r for r in _releases() if r['version'] == version), None)
    if not release or version_tuple(version) <= version_tuple(current_version()):
        raise ValueError('That version is not a newer release.')
    with _lock:
        _job.clear()
        _job.update(state='downloading', version=version, done=0, total=release['installer']['size'])
    threading.Thread(target=_run_download, args=(release,), daemon=True).start()
    return status()


def status():
    with _lock:
        return {k: _job[k] for k in ('state', 'version', 'done', 'total', 'error', 'verified') if k in _job} or dict(state='idle')


def install():
    """Start the downloaded installer. It offers Update, asks to close DeusEdix and starts it again at the end."""
    with _lock:
        path = _job.get('path') if _job.get('state') == 'ready' else None
    if not path or not Path(path).is_file() or Path(path).parent != _folder():
        raise ValueError('Download the update first.')
    if os.name != 'nt':
        raise ValueError('Run the installer yourself: %s' % path)
    subprocess.Popen([path], cwd=str(_folder()), close_fds=True,
                     creationflags=getattr(subprocess, 'DETACHED_PROCESS', 0) | getattr(subprocess, 'CREATE_NEW_PROCESS_GROUP', 0))
    with _lock:
        _job.update(state='started')
    return status()
