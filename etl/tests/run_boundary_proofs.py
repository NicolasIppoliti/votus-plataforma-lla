"""Run only test_etl_boundary_proofs.py through the owned verification harness."""

import os
import shutil
import subprocess
from pathlib import Path

from etl.verify import DisposablePostgres, apply_migrations, run_pytest

ETL_ROOT = Path(__file__).resolve().parents[1]
TEST_FILE = "tests/test_etl_boundary_proofs.py"


def require_disk():
    if shutil.disk_usage(ETL_ROOT).free < 2 * 1024**3:
        raise RuntimeError("boundary proofs require at least 2 GiB free")


def focused_run(command, **kwargs):
    require_disk()
    if command[1:3] != ["-m", "pytest"]:
        raise RuntimeError("unexpected harness command")
    env = kwargs["env"]
    # Do not inherit ambient database or pytest overrides; the harness owns inputs.
    env.update(PYTHONPATH=".", PYTHONDONTWRITEBYTECODE="1")
    return subprocess.run([*command, TEST_FILE, "-p", "no:cacheprovider"], **kwargs)


def main():
    require_disk()
    admin = os.environ.get("ETL_TEST_ADMIN_DATABASE_URL")
    if not admin:
        raise RuntimeError("explicit ETL_TEST_ADMIN_DATABASE_URL is required; no fallback")
    owned = DisposablePostgres(admin)
    with owned as dsn:
        require_disk()
        apply_migrations(owned.migration_dsn, ETL_ROOT.parent / "supabase/migrations")
        owned.grant_test_privileges()
        result = run_pytest(dsn, ETL_ROOT, owned, run=focused_run)
        print(f"Boundary proofs: {result.executed} passed, {result.skipped} skipped")


if __name__ == "__main__":
    main()
