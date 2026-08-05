"""Local filesystem archive storage.

``LocalArchiveStore`` is always active: every source archived by the ETL
pipeline is written to disk under ``archive/<capability>/<filename>``
first. This local copy, plus the committed ``archive-manifest.json``, is
the ground truth for provenance (design D2) — there is no database mirror
of raw bytes.

This module also owns safe extraction of archived ZIP files
(``extract_zip_safely``). National election ZIPs are official-source
downloads, but nothing about the archive pipeline verifies that a mirror
host cannot serve a crafted file, so extraction rejects path-traversal
entries and refuses to inflate content past a size cap before writing any
bytes to disk.
"""

from __future__ import annotations

import hashlib
import zipfile
from dataclasses import dataclass
from pathlib import Path, PurePosixPath

DEFAULT_MAX_UNCOMPRESSED_BYTES = 8 * 1024**3  # 8 GiB — comfortably above the
# ~3.7 GB / ~42x ratio the SPIKE measured on the largest real national ZIP
# (2023 PASO), while still bounding truly excessive (bomb-shaped) payloads.


class UnsafeZipEntryError(ValueError):
    """Raised when a ZIP entry's name would extract outside the destination
    directory (an absolute path or a ``..`` traversal segment).
    """


class DecompressionBombError(ValueError):
    """Raised when a ZIP's declared uncompressed size exceeds the configured
    cap, detected from the central directory before any entry is inflated.
    """


def sha256_of(data: bytes) -> str:
    """Return the hex-encoded SHA-256 digest of ``data``."""
    return hashlib.sha256(data).hexdigest()


@dataclass(frozen=True)
class LocalArchiveStore:
    """Writes fetched bytes to a local directory tree, one folder per capability."""

    root: Path

    def path_for(self, capability: str, filename: str) -> Path:
        return self.root / capability / filename

    def write(self, capability: str, filename: str, data: bytes) -> Path:
        target = self.path_for(capability, filename)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
        return target

    def exists(self, capability: str, filename: str) -> bool:
        return self.path_for(capability, filename).exists()

    def read(self, capability: str, filename: str) -> bytes:
        return self.path_for(capability, filename).read_bytes()


def _is_safe_member_name(name: str) -> bool:
    """Reject absolute paths and ``..`` traversal segments.

    Uses ``PurePosixPath`` because ZIP entry names always use ``/``
    separators regardless of the extracting platform.
    """
    if not name or name.startswith("/") or name.startswith("\\"):
        return False
    pure = PurePosixPath(name)
    if pure.is_absolute():
        return False
    return ".." not in pure.parts


def extract_zip_safely(
    data: bytes,
    dest_dir: Path,
    *,
    max_uncompressed_bytes: int = DEFAULT_MAX_UNCOMPRESSED_BYTES,
) -> list[Path]:
    """Extract an in-memory ZIP archive to ``dest_dir``, rejecting unsafe
    entries and oversized content before writing anything.

    Two checks run against the ZIP's central directory BEFORE any entry is
    inflated:

    1. every entry name must resolve inside ``dest_dir`` (no absolute path,
       no ``..`` traversal);
    2. the total declared uncompressed size across all entries must not
       exceed ``max_uncompressed_bytes``.

    Only after both checks pass for the whole archive does extraction write
    files to disk, so a crafted ZIP never gets a partial extraction on disk.
    """
    import io

    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        infos = [info for info in zf.infolist() if not info.is_dir()]

        for info in infos:
            if not _is_safe_member_name(info.filename):
                raise UnsafeZipEntryError(
                    f"unsafe ZIP entry name: {info.filename!r}"
                )

        total_uncompressed = sum(info.file_size for info in infos)
        if total_uncompressed > max_uncompressed_bytes:
            raise DecompressionBombError(
                f"declared uncompressed size {total_uncompressed} bytes exceeds "
                f"the {max_uncompressed_bytes} byte cap"
            )

        extracted: list[Path] = []
        for info in infos:
            target = dest_dir / info.filename
            target.parent.mkdir(parents=True, exist_ok=True)
            with zf.open(info) as source, target.open("wb") as out:
                out.write(source.read())
            extracted.append(target)

    return extracted
