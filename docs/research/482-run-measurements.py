"""Disk-guarded wrapper for the existing #482 parser measurement runner."""
import os
import runpy
import shutil
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

created = []
original_mkdtemp = tempfile.mkdtemp
original_check_output = subprocess.check_output


def check_disk():
    subprocess.run(["df", "-h", "/"], check=True)
    if shutil.disk_usage("/").free < 3 * 1024**3:
        raise RuntimeError("STOP: free disk below 3 GiB")


def checked(*args, **kwargs):
    check_disk()
    return original_check_output(*args, **kwargs)


def owned(*args, **kwargs):
    path = original_mkdtemp(*args, **kwargs)
    created.append(path)
    return path


if __name__ == "__main__":
    check_disk()
    archive = Path(sys.argv[sys.argv.index("--archive") + 1])
    with zipfile.ZipFile(archive) as bundle:
        required = sum(
            member.file_size
            for member in bundle.infolist()
            if (
                "resultados" in Path(member.filename).name.lower()
                and not member.filename.startswith("__MACOSX/")
            )
            or Path(member.filename).name == "localesDeVotacionyMesas.csv"
        )
    reserve_gib = float(os.environ.get("VOTUS_482_RESERVE_GIB", "3"))
    if shutil.disk_usage("/").free - required < reserve_gib * 1024**3:
        raise RuntimeError(f"STOP: extraction would leave less than {reserve_gib} GiB free")
    subprocess.check_output = checked
    tempfile.mkdtemp = owned
    sys.argv[0] = str(Path(__file__).with_name("national-preflight-benchmark.py"))
    try:
        runpy.run_path(sys.argv[0], run_name="__main__")
    finally:
        for path in created:
            if Path(path).parent == Path("/tmp") and Path(path).name.startswith("votus-482-"):
                shutil.rmtree(path)
                print("Removed task-owned extraction:", path)
