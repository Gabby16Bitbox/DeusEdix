from pathlib import Path
import hashlib
import tempfile
import unittest

import preview_bundle


class ParallelDigests(unittest.TestCase):
    def test_large_batch_has_the_exact_sequential_digests(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            files = {}
            for i in range(40):
                file = root / (str(i)+'.bin')
                file.write_bytes(bytes([i]) * (256+i))
                files[file.name] = file
            expected = {name: hashlib.sha256(path.read_bytes()).hexdigest() for name,path in files.items()}
            self.assertEqual(preview_bundle._digests(files), expected)
            files['12.bin'].write_bytes(b'changed')
            self.assertNotEqual(preview_bundle._digests(files), expected)

    def test_missing_file_never_produces_partial_success(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            file = root / 'valid'
            file.write_bytes(b'data')
            files = {str(i):file for i in range(40)}
            files['missing'] = root/'missing'
            with self.assertRaises(OSError):
                preview_bundle._digests(files)


if __name__ == '__main__': unittest.main()
