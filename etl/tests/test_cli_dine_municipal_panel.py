"""Public-entry inventory contracts using synthetic, non-electoral ZIPs."""
import csv
import hashlib
import io
import json
import subprocess
import sys
import zipfile
from pathlib import Path

import pytest

MODULE = Path(__file__).parents[1] / "etl" / "dine_municipal_panel.py"
HEADER = ["cargo_nombre", "Año", "seccion_id", "distrito_id", "circuito_id",
          "mesa_id", "mesa_tipo", "mesa_electores", "agrupacion_id",
          "agrupacion_nombre", "votos_tipo", "votos_cantidad"]


def payload(rows, header=HEADER):
    text = io.StringIO(newline="")
    writer = csv.writer(text)
    writer.writerow(header)
    writer.writerows(rows)
    return ("\ufeff" + text.getvalue()).encode("utf-8")


def row(cargo="CONCEJALES ", year="2021", seccion="27", distrito="2",
        circuito="1", mesa="1", tipo="NORMAL ", votos="POSITIVO "):
    return [cargo, year, seccion, distrito, circuito, mesa, tipo, "100",
            "10", "PUBLIC SYNTHETIC", votos, "5"]


def archive(tmp_path, members):
    path = tmp_path / "input.zip"
    with zipfile.ZipFile(path, "w") as target:
        for name, data in members.items():
            target.writestr(name, data)
    return path, hashlib.sha256(path.read_bytes()).hexdigest()


def invoke(path=None, digest=None, *args):
    command = [sys.executable, "-I", "-S", "-B", str(MODULE)]
    if path is not None:
        command += ["inventory", "--archive", str(path), "--expected-sha256", digest,
                    "--year", "2021", "--distrito", "2", "--seccion", "27"]
    return subprocess.run(command + list(args), capture_output=True, text=True, timeout=10)


def test_help():
    result = invoke(None, None, "--help")
    assert result.returncode == 0
    assert "inventory" in result.stdout
    assert result.stderr == ""


def test_inventory_exact(tmp_path):
    data = payload([row(), row(circuito="00001", votos="BLANCO "),
                    row(circuito="2", tipo="EXTRANJEROS "),
                    row(circuito="1", tipo="EXTRANJEROS "),
                    row(" DIPUTADOS "), row(seccion="28"), row(distrito="3")])
    path, digest = archive(tmp_path, {"results.csv": data, "lookup.csv": b"id,name\n"})
    result = invoke(path, digest)
    expected = {
        "schema_version": 1,
        "source": {"archive_sha256": digest, "archive_bytes": path.stat().st_size,
                   "member": "results.csv", "member_bytes": len(data), "header": HEADER},
        "year": 2021, "distrito": "02", "seccion": "027",
        "total_rows": 7, "selected_rows": 5,
        "excluded_rows_by_reason": {"other_jurisdiction": 2},
        "categories": {
            "CONCEJALES": {"rows": 4, "distinct_mesas": 3,
                           "mesa_tipo": {"NORMAL": 2, "EXTRANJEROS": 2},
                           "votos_tipo": {"POSITIVO": 3, "BLANCO": 1}},
            "DIPUTADOS": {"rows": 1, "distinct_mesas": 1,
                          "mesa_tipo": {"NORMAL": 1}, "votos_tipo": {"POSITIVO": 1}}}}
    assert result.returncode == 0, result.stderr
    assert result.stderr == ""
    assert result.stdout == json.dumps(expected, sort_keys=True, ensure_ascii=False) + "\n"


def test_sha_mismatch(tmp_path):
    path, digest = archive(tmp_path, {"results.csv": payload([row()])})
    result = invoke(path, "0" * 64)
    assert result.returncode == 2
    assert result.stdout == ""
    assert result.stderr == f"error: archive sha256 mismatch: expected {'0' * 64} got {digest}\n"


@pytest.mark.parametrize("names", [[], ["a.csv", "b.csv"]])
def test_member_cardinality(tmp_path, names):
    path, digest = archive(tmp_path, {name: payload([row()]) for name in names})
    result = invoke(path, digest)
    assert result.returncode == 2
    assert result.stdout == ""
    assert result.stderr == f"error: expected exactly one results member, found {len(names)}: {names}\n"


@pytest.mark.parametrize("data", [b"\xff\n", payload([row()]) + b"\xff\n"])
def test_invalid_utf8(tmp_path, data):
    path, digest = archive(tmp_path, {"results.csv": data})
    result = invoke(path, digest)
    assert result.returncode == 2
    assert result.stdout == ""
    assert result.stderr.startswith("error: results member is not valid UTF-8 at byte offset ")
    assert result.stderr.removeprefix(
        "error: results member is not valid UTF-8 at byte offset ").strip().isdigit()


def test_year_mismatch_scans_excluded_rows(tmp_path):
    path, digest = archive(tmp_path, {"results.csv": payload([
        row(year="2017"), row(year="2019", distrito="3"), row(year="2017")])})
    result = invoke(path, digest)
    assert result.returncode == 2
    assert result.stdout == ""
    assert result.stderr == 'error: row year mismatch: expected 2021, counts {"2017": 2, "2019": 1}\n'


@pytest.mark.parametrize("year_header", ["ano", " año ", "ANO"])
def test_year_header_variants(tmp_path, year_header):
    header = [year_header if name == "Año" else name.upper() for name in HEADER]
    path, digest = archive(tmp_path, {"results.CSV": payload([row()], header)})
    result = invoke(path, digest)
    assert result.returncode == 0, result.stderr
    assert json.loads(result.stdout)["source"]["header"] == header
