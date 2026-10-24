"""Copy exactly the bytes validated before native reload into a new private file."""
from pathlib import Path
import hashlib, os


def copy_verified(source, destination, expected_sha256):
    source = Path(source)
    destination = Path(destination)
    data = source.read_bytes()
    if hashlib.sha256(data).hexdigest() != expected_sha256:
        raise ValueError('Verified candidate changed before its bytes were copied.')
    with destination.open('xb') as stream:
        stream.write(data)
        stream.flush()
        os.fsync(stream.fileno())
    if hashlib.sha256(destination.read_bytes()).hexdigest() != expected_sha256:
        destination.unlink()
        raise ValueError('Verified candidate copy changed.')
    return expected_sha256
