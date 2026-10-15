"""Conservative national official projection receipts; caller owns transaction/commit."""

from __future__ import annotations

import hashlib
import io
import json
import sys
import zipfile
from pathlib import Path

import psycopg
from psycopg import sql
from psycopg.types.json import Jsonb

TABLES = (
    "result_row",
    "official_expected_mesa",
    "official_mesa_count_status",
    "official_mesa_completeness_quarantine",
)
# Hash executable normalization, selection, and persistence dependencies rather than
# relying on an operator remembering to increment a version after changing them.
TRANSFORM_FILES = (
    "__main__.py",
    "ingest/national.py",
    "jurisdiction.py",
    "admin_codes.py",
    "archive.py",
    "numeric.py",
    "db.py",
    "projection_receipt.py",
)


def fingerprint(raw: bytes, *, year: int, round_: str, source_kind: str) -> str:
    members = None
    if zipfile.is_zipfile(io.BytesIO(raw)):
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            members = [(m.filename, m.CRC, m.file_size) for m in archive.infolist()]
    root = Path(__file__).parent
    identity = {
        "contract": 1,
        "archive_sha256": hashlib.sha256(raw).hexdigest(),
        # The complete ordered member inventory plus archive digest and selection
        # code fixes both selected member and every potential companion identity.
        "members": members,
        "election": [year, round_],
        "source_kind": source_kind,
        "runtime": {"python": list(sys.version_info[:3]), "psycopg": psycopg.__version__},
        "transform": {
            p: hashlib.sha256((root / p).read_bytes()).hexdigest() for p in TRANSFORM_FILES
        },
    }
    return hashlib.sha256(json.dumps(identity, sort_keys=True).encode()).hexdigest()


def projection(conn, archive_entry_id: str, election_id: str) -> dict:
    """One MVCC snapshot, bounded aggregate state, independent of row order.

    Each SHA-256 is split into four signed 64-bit words summed as exact numeric.
    Count + all four sums preserve duplicates and empty sets, without sorting or
    string_agg of a corpus. Full persisted rows (including IDs) are protected.
    """
    queries = []
    params = []
    for table in TABLES:
        extra = sql.SQL(" and source_kind = 'official'") if table == "result_row" else sql.SQL("")
        queries.append(
            sql.SQL("""
            select %s::text as name, jsonb_build_array(count(*),
              coalesce(sum(('x' || substr(h,1,16))::bit(64)::bigint::numeric),0),
              coalesce(sum(('x' || substr(h,17,16))::bit(64)::bigint::numeric),0),
              coalesce(sum(('x' || substr(h,33,16))::bit(64)::bigint::numeric),0),
              coalesce(sum(('x' || substr(h,49,16))::bit(64)::bigint::numeric),0)) as signature
            from (select encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex') h
              from public.{} t where archive_entry_id=%s and election_id=%s {} offset 0) rows
        """).format(sql.Identifier(table), extra)
        )
        params.extend((table, archive_entry_id, election_id))
    with conn.cursor() as cur:
        cur.execute(
            sql.SQL("select jsonb_object_agg(name,signature) from ({}) signatures").format(
                sql.SQL(" union all ").join(queries)
            ),
            params,
        )
        return cur.fetchone()[0]


def reusable(conn, *, archive_entry_id: str, election_id: str, identity: str) -> dict | None:
    with conn.cursor() as cur:
        cur.execute(
            """select projection from public.projection_receipt
            where archive_entry_id=%s and election_id=%s and source_kind='official'
            and fingerprint=%s""",
            (archive_entry_id, election_id, identity),
        )
        row = cur.fetchone()
    if row is None:
        return None
    actual = projection(conn, archive_entry_id, election_id)
    return actual if row[0] == actual else None


def publish(conn, *, archive_entry_id: str, election_id: str, identity: str) -> None:
    signature = projection(conn, archive_entry_id, election_id)
    with conn.cursor() as cur:
        cur.execute(
            """insert into public.projection_receipt
            (archive_entry_id,election_id,source_kind,fingerprint,projection)
            values (%s,%s,'official',%s,%s)
            on conflict (archive_entry_id,election_id,source_kind)
            do update set fingerprint=excluded.fingerprint, projection=excluded.projection""",
            (archive_entry_id, election_id, identity, Jsonb(signature)),
        )
