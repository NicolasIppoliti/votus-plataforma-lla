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
from pathlib import Path, PurePosixPath, PureWindowsPath
from typing import Protocol

DEFAULT_MAX_UNCOMPRESSED_BYTES = 8 * 1024**3  # 8 GiB — comfortably above the
# ~3.7 GB / ~42x ratio the SPIKE measured on the largest real national ZIP
# (2023 PASO), while still bounding truly excessive (bomb-shaped) payloads.
ZIP_READ_CHUNK_BYTES = 1024 * 1024


class UnsafeZipEntryError(ValueError):
    """Raised when ZIP member targets are unsafe or would overwrite data."""


class DecompressionBombError(ValueError):
    """Raised when a ZIP's declared uncompressed size exceeds the configured
    cap, detected from the central directory before any entry is inflated.
    """


class UnsafeArchivePathComponentError(ValueError):
    """Raised when an archive capability or filename is not one safe component."""


def _safe_archive_path_component(value: object, *, label: str) -> str:
    if (
        not isinstance(value, str)
        or not value.strip()
        or value in {".", ".."}
        or "\0" in value
        or "/" in value
        or "\\" in value
        or Path(value).is_absolute()
        or bool(PureWindowsPath(value).drive)
    ):
        raise UnsafeArchivePathComponentError(
            f"archive {label} must be one non-empty safe relative path component, got {value!r}"
        )
    return value


def sha256_of(data: bytes) -> str:
    """Return the hex-encoded SHA-256 digest of ``data``."""
    return hashlib.sha256(data).hexdigest()


class ArchiveStore(Protocol):
    """Storage operations required by the archive pipeline."""

    @property
    def root(self) -> Path: ...

    def path_for(self, capability: str, filename: str) -> Path: ...

    def write(self, capability: str, filename: str, data: bytes) -> Path: ...

    def exists(self, capability: str, filename: str) -> bool: ...

    def read(self, capability: str, filename: str) -> bytes: ...


@dataclass(frozen=True)
class LocalArchiveStore:
    """Writes fetched bytes to a local directory tree, one folder per capability."""

    root: Path

    def path_for(self, capability: str, filename: str) -> Path:
        safe_capability = _safe_archive_path_component(capability, label="capability")
        safe_filename = _safe_archive_path_component(filename, label="filename")
        return self.root / safe_capability / safe_filename

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
    """Reject names unsafe under either POSIX or Windows path semantics."""
    if not name or "\\" in name:
        return False

    posix_path = PurePosixPath(name)
    windows_path = PureWindowsPath(name)
    if posix_path.is_absolute() or windows_path.is_absolute() or windows_path.drive:
        return False
    return ".." not in posix_path.parts and ".." not in windows_path.parts


def extract_zip_safely(
    data: bytes,
    dest_dir: Path,
    *,
    max_uncompressed_bytes: int = DEFAULT_MAX_UNCOMPRESSED_BYTES,
) -> list[Path]:
    """Extract an in-memory ZIP archive to ``dest_dir``, rejecting unsafe
    entries and oversized content before writing anything.

    Preflight checks run against the ZIP's central directory BEFORE any entry
    is inflated: names must be safe, member targets must not collide or already
    exist, and the total declared uncompressed size must stay within
    ``max_uncompressed_bytes``.

    Only after both checks pass for the whole archive does extraction write
    files to disk. Inflation is streamed in bounded chunks and the same cap is
    enforced against bytes actually returned by the decompressor. Any runtime
    failure removes files written by this extraction attempt.
    """
    import io

    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        all_infos = zf.infolist()
        member_shapes: dict[PurePosixPath, str] = {}
        explicit_targets: list[PurePosixPath] = []

        for info in all_infos:
            if not _is_safe_member_name(info.filename):
                raise UnsafeZipEntryError(f"unsafe ZIP entry name: {info.filename!r}")

            relative = PurePosixPath(info.filename)
            shape = "directory" if info.is_dir() else "file"
            existing_shape = member_shapes.get(relative)
            if existing_shape == "file" and shape == "file":
                raise UnsafeZipEntryError(f"duplicate ZIP file target: {info.filename!r}")
            if existing_shape is not None and existing_shape != shape:
                raise UnsafeZipEntryError(f"colliding ZIP entry targets: {info.filename!r}")
            member_shapes[relative] = shape
            explicit_targets.append(relative)

            for parent in relative.parents:
                if parent == PurePosixPath("."):
                    continue
                if member_shapes.get(parent) == "file":
                    raise UnsafeZipEntryError(f"colliding ZIP entry targets: {info.filename!r}")
                member_shapes.setdefault(parent, "directory")

            if shape == "file":
                for descendant, descendant_shape in member_shapes.items():
                    if relative in descendant.parents and descendant_shape in {
                        "file",
                        "directory",
                    }:
                        raise UnsafeZipEntryError(f"colliding ZIP entry targets: {info.filename!r}")

        for relative in explicit_targets:
            target = dest_dir.joinpath(*relative.parts)
            if target.exists() or target.is_symlink():
                raise UnsafeZipEntryError(f"ZIP target already exists: {relative.as_posix()!r}")
            for parent in target.parents:
                if parent == dest_dir.parent:
                    break
                if parent.is_symlink() or (parent.exists() and not parent.is_dir()):
                    raise UnsafeZipEntryError(f"unsafe existing ZIP target parent: {parent!s}")

        infos = [info for info in all_infos if not info.is_dir()]
        total_uncompressed = sum(info.file_size for info in infos)
        if total_uncompressed > max_uncompressed_bytes:
            raise DecompressionBombError(
                f"declared uncompressed size {total_uncompressed} bytes exceeds "
                f"the {max_uncompressed_bytes} byte cap"
            )

        extracted: list[Path] = []
        created_files: list[Path] = []
        created_directories: list[Path] = []
        actual_uncompressed = 0

        def ensure_directory(directory: Path) -> None:
            missing: list[Path] = []
            current = directory
            while current != dest_dir.parent and not current.exists():
                missing.append(current)
                current = current.parent
            if current.is_symlink() or (current.exists() and not current.is_dir()):
                raise UnsafeZipEntryError(f"unsafe existing ZIP target parent: {current!s}")
            for path in reversed(missing):
                path.mkdir()
                created_directories.append(path)

        try:
            for info in infos:
                relative = PurePosixPath(info.filename)
                target = dest_dir.joinpath(*relative.parts)
                ensure_directory(target.parent)
                with zf.open(info) as source, target.open("xb") as out:
                    created_files.append(target)
                    while chunk := source.read(ZIP_READ_CHUNK_BYTES):
                        actual_uncompressed += len(chunk)
                        if actual_uncompressed > max_uncompressed_bytes:
                            raise DecompressionBombError(
                                f"actual uncompressed size exceeds the "
                                f"{max_uncompressed_bytes} byte cap"
                            )
                        out.write(chunk)
                extracted.append(target)
        except Exception:
            for target in reversed(created_files):
                try:
                    target.unlink(missing_ok=True)
                except Exception:
                    pass
            for directory in sorted(
                created_directories, key=lambda path: len(path.parts), reverse=True
            ):
                try:
                    directory.rmdir()
                except Exception:
                    pass
            raise

    return extracted
