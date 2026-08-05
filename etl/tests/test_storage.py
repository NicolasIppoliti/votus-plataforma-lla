"""Unit tests for the local archive storage seam (etl.storage).

Includes the threat-matrix tests for untrusted archive extraction (D2):
national ZIPs are official-source downloads, but nothing prevents a
compromised/mirrored host from serving a crafted ZIP, so extraction MUST
reject path-traversal entries and refuse to inflate past a size cap before
any bytes are written to disk.
"""

import io
import zipfile

import pytest

from etl.storage import (
    DecompressionBombError,
    LocalArchiveStore,
    UnsafeZipEntryError,
    extract_zip_safely,
    sha256_of,
)


def test_sha256_of_known_value() -> None:
    assert sha256_of(b"hello") == (
        "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
    )


def test_write_creates_file_under_capability_dir(tmp_path) -> None:
    store = LocalArchiveStore(root=tmp_path)
    target = store.write("national", "sample.csv", b"a,b,c\n1,2,3\n")

    assert target == tmp_path / "national" / "sample.csv"
    assert target.read_bytes() == b"a,b,c\n1,2,3\n"


def test_exists_reflects_written_file(tmp_path) -> None:
    store = LocalArchiveStore(root=tmp_path)
    assert store.exists("national", "results.zip") is False

    store.write("national", "results.zip", b"PK\x03\x04")
    assert store.exists("national", "results.zip") is True


def test_read_returns_previously_written_bytes(tmp_path) -> None:
    store = LocalArchiveStore(root=tmp_path)
    store.write("national", "results.zip", b"PK\x03\x04 fake")

    assert store.read("national", "results.zip") == b"PK\x03\x04 fake"


def _zip_bytes(entries: dict[str, bytes]) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        for name, data in entries.items():
            zf.writestr(name, data)
    return buffer.getvalue()


def test_zip_entry_with_absolute_path_rejected(tmp_path) -> None:
    data = _zip_bytes({"/etc/passwd": b"root:x:0:0::/root:/bin/sh"})
    dest = tmp_path / "extracted"

    with pytest.raises(UnsafeZipEntryError):
        extract_zip_safely(data, dest)

    assert not dest.exists() or list(dest.iterdir()) == []


def test_zip_entry_with_dotdot_traversal_rejected(tmp_path) -> None:
    data = _zip_bytes({"../../etc/passwd": b"root:x:0:0::/root:/bin/sh"})
    dest = tmp_path / "extracted"

    with pytest.raises(UnsafeZipEntryError):
        extract_zip_safely(data, dest)

    assert not dest.exists() or list(dest.iterdir()) == []


def test_decompression_bomb_exceeds_size_cap_fails_loudly(tmp_path) -> None:
    # Highly compressible payload: 20 MiB of zero bytes deflates to a few KB,
    # simulating a bomb-shaped ratio far beyond the ~40x national-results
    # ratio the SPIKE measured on real data (elecciones_legislativas_2025.zip
    # ~38x, the 2023 PASO ZIP ~42x).
    bomb_payload = b"\x00" * (20 * 1024 * 1024)
    data = _zip_bytes({"resultados.csv": bomb_payload})
    dest = tmp_path / "extracted"

    # A cap sized to comfortably tolerate the SPIKE's ~40x ratio on a small
    # compressed input, but well below the crafted 20 MiB payload above.
    with pytest.raises(DecompressionBombError):
        extract_zip_safely(data, dest, max_uncompressed_bytes=1024 * 1024)

    assert not dest.exists() or list(dest.iterdir()) == []


def test_legitimate_high_ratio_zip_within_cap_extracts_successfully(tmp_path) -> None:
    # Same ~compressible shape as a real national-results CSV (SPIKE-measured
    # ratios up to ~42x), but sized to stay under a realistic production cap.
    payload = b"0,1,2,3\n" * 200_000  # highly compressible, legitimate-shaped
    data = _zip_bytes({"resultados2025.csv": payload})
    dest = tmp_path / "extracted"

    extracted = extract_zip_safely(data, dest, max_uncompressed_bytes=64 * 1024 * 1024)

    assert extracted == [dest / "resultados2025.csv"]
    assert (dest / "resultados2025.csv").read_bytes() == payload
