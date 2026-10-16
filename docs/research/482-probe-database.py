"""Local-only disposable benchmark setup probe; never prints connection secrets."""
import json
import shutil
import subprocess

from psycopg.conninfo import conninfo_to_dict, make_conninfo

from etl.benchmark import clone_schema
from etl.verify import DisposablePostgres

subprocess.run(["df", "-h", "/"], check=True)
if shutil.disk_usage("/").free < 3 * 1024**3:
    raise SystemExit("STOP: free disk below 3 GiB")
status = subprocess.run(
    ["supabase", "status", "-o", "env"],
    cwd="/Users/nicolasmateoippoliti/dev/votus-plataforma-lla",
    capture_output=True,
    text=True,
)
if status.returncode:
    raise SystemExit("supabase status failed; output withheld")
values = dict(
    line.split("=", 1) for line in status.stdout.splitlines() if "=" in line
)
local = conninfo_to_dict(values["DB_URL"].strip('"'))
if local.get("host") not in {"127.0.0.1", "localhost", "::1"}:
    raise SystemExit("Refusing non-local host")
schema = local["dbname"]
local.update(host="127.0.0.1", dbname="template1")
admin = make_conninfo(**local)
stage = "create_owned_database"
database = DisposablePostgres(admin)
try:
    with database:
        stage = "clone_schema"
        digest = clone_schema(admin, database, schema)
        print(json.dumps({"stage": stage, "status": "passed", "schema_dump_sha256": digest}))
        stage = "grant_test_privileges"
        database.grant_test_privileges()
        print(json.dumps({"stage": stage, "status": "passed"}))
except Exception as error:
    # Never expose subprocess argv (pg_restore receives a connection string).
    diagnostic = None
    if isinstance(error, subprocess.CalledProcessError):
        text = (error.stderr or b"").decode(errors="replace")
        password = local.get("password", "")
        diagnostic = text.replace(admin, "<local-connection>")
        if password:
            diagnostic = diagnostic.replace(password, "<redacted>")
    print(json.dumps({"stage": stage, "status": "failed", "exception": type(error).__name__, "sqlstate": getattr(error, "sqlstate", None), "diagnostic": diagnostic}))
    raise SystemExit(1)
print("Owned database context exited successfully; no ingestion attempted")
