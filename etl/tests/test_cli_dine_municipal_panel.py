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


def invoke(path=None, digest=None, *args, command_name="inventory"):
    command = [sys.executable, "-I", "-S", "-B", str(MODULE)]
    if path is not None:
        command += [command_name, "--archive", str(path), "--expected-sha256", digest,
                    "--year", "2021", "--distrito", "2", "--seccion", "27"]
    return subprocess.run(command + list(args), capture_output=True, text=True, timeout=10)


def mesa_row(**kwargs):
    return row(tipo="NATIVO", **kwargs)


def run_mesas(tmp_path, rows, header=HEADER, cargo="CONCEJALES"):
    path, digest = archive(tmp_path, {"results.csv": payload(rows, header)})
    result = invoke(path, digest, "--cargo", cargo, command_name="mesas")
    assert result.returncode == 0, result.stderr
    return json.loads(result.stdout)


def test_mesas_happy_path_and_totals(tmp_path):
    rows = [mesa_row(), mesa_row(votos="EN BLANCO"),
            row(tipo="EXTRANJERO", mesa="2"), row(tipo="EXTRANJEROS", mesa="2", votos="NULOS"),
            mesa_row(cargo="DIPUTADOS"), mesa_row(seccion="28")]
    data = run_mesas(tmp_path, rows)
    assert len(data["mesas"]) == 2
    assert data["totals"]["mesas"] == 2
    assert data["totals"]["electores"] == 200
    assert data["totals"]["votes"] == dict(positivo=10, blancos=5, nulos=5,
                                               impugnados=0, recurridos=0, comando=0)
    assert data["totals"]["positive"] == {"10": {"name": "PUBLIC SYNTHETIC", "votes": 10}}
    assert sum(p["votes"] for p in data["totals"]["positive"].values()) == data["totals"]["votes"]["positivo"]
    for tipo, total in data["totals"]["votes"].items():
        assert total == sum(m["votes"][tipo] for m in data["mesas"])
    for mesa in data["mesas"]:
        assert sum(p["votes"] for p in mesa["positive"].values()) == mesa["votes"]["positivo"]
        assert mesa["source_rows"] == 2
    assert data["mesas"][0]["circuito"] == "00001"
    assert data["mesas"][1]["mesa_tipo"] == "EXTRANJEROS"
    assert data["label_aliases_used"]["NATIVO"]["NATIVOS"] == 2
    assert data["excluded_rows_by_reason"]["other_cargo"] == 1
    assert data["excluded_rows_by_reason"]["other_jurisdiction"] == 1


@pytest.mark.parametrize("reason,index,value", [
    ("unknown_mesa_tipo", 6, "NORMAL"), ("unknown_votos_tipo", 10, "BLANCO"),
    ("non_integer_votes", 11, "-1"), ("non_integer_votes", 11, "1.0"),
    ("non_integer_electores", 7, ""), ("positive_without_agrupacion", 8, " "),
    ("short_row", None, None), ("short_row", None, "extra")])
def test_mesas_row_exclusion_reason(tmp_path, reason, index, value):
    bad = mesa_row()
    if index is None:
        bad = bad[:-1] if value is None else bad + [value]
    else:
        bad[index] = value
    data = run_mesas(tmp_path, [mesa_row(), bad])
    assert data["excluded_rows_by_reason"][reason] == 1
    assert data["totals"]["votes"]["positivo"] == 5
    assert sum(data["quarantined_mesas_by_reason"].values()) == 0


@pytest.mark.parametrize("reason,index,value", [
    ("conflicting_electores", 7, "101"), ("duplicate_tally", 11, "6"),
    ("conflicting_agrupacion_name", 9, "OTHER SYNTHETIC")])
def test_mesas_quarantine_reason(tmp_path, reason, index, value):
    second = mesa_row()
    second[index] = value
    if reason == "conflicting_agrupacion_name":
        second[5] = "2"
    data = run_mesas(tmp_path, [mesa_row(), second])
    count = 2 if reason == "conflicting_agrupacion_name" else 1
    assert data["quarantined_mesas_by_reason"][reason] == count
    assert all(reason in m["reasons"] for m in data["quarantined_mesas"])
    assert data["totals"]["mesas"] == 0
    assert data["totals"]["votes"]["positivo"] == 0


def test_mesas_multiple_lists_per_agrupacion(tmp_path):
    data = run_mesas(tmp_path, [mesa_row() + ["1"], mesa_row(mesa="2") + ["2"]],
                     HEADER + ["lista_numero"])
    assert data["quarantined_mesas_by_reason"]["multiple_lists_per_agrupacion"] == 2
    assert data["mesas"] == []


def test_mesas_duplicate_non_positive_tally(tmp_path):
    data = run_mesas(tmp_path, [mesa_row(votos="NULO"), mesa_row(votos="NULOS")])
    assert data["quarantined_mesas_by_reason"]["duplicate_tally"] == 1
    assert data["mesas"] == []


def test_mesas_absent_cargo_is_explicit_empty_success(tmp_path):
    data = run_mesas(tmp_path, [mesa_row()], cargo="ABSENT")
    assert data["cargo"] == "ABSENT"
    assert data["mesas"] == data["quarantined_mesas"] == []
    assert data["totals"]["mesas"] == data["totals"]["electores"] == 0
    assert data["totals"]["positive"] == {}
    assert not any(data["totals"]["votes"].values())


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


@pytest.mark.parametrize("command_name", ["inventory", "mesas"])
def test_sha_mismatch(tmp_path, command_name):
    path, digest = archive(tmp_path, {"results.csv": payload([row()])})
    result = invoke(path, "0" * 64, *(["--cargo", "CONCEJALES"] if command_name == "mesas" else []),
                    command_name=command_name)
    assert result.returncode == 2
    assert result.stdout == ""
    assert result.stderr == f"error: archive sha256 mismatch: expected {'0' * 64} got {digest}\n"


@pytest.mark.parametrize("names", [[], ["a.csv", "b.csv"]])
@pytest.mark.parametrize("command_name", ["inventory", "mesas"])
def test_member_cardinality(tmp_path, names, command_name):
    path, digest = archive(tmp_path, {name: payload([row()]) for name in names})
    result = invoke(path, digest, *(["--cargo", "CONCEJALES"] if command_name == "mesas" else []),
                    command_name=command_name)
    assert result.returncode == 2
    assert result.stdout == ""
    assert result.stderr == f"error: expected exactly one results member, found {len(names)}: {names}\n"


@pytest.mark.parametrize("data", [b"\xff\n", payload([row()]) + b"\xff\n"])
@pytest.mark.parametrize("command_name", ["inventory", "mesas"])
def test_invalid_utf8(tmp_path, data, command_name):
    path, digest = archive(tmp_path, {"results.csv": data})
    result = invoke(path, digest, *(["--cargo", "CONCEJALES"] if command_name == "mesas" else []),
                    command_name=command_name)
    assert result.returncode == 2
    assert result.stdout == ""
    assert result.stderr.startswith("error: results member is not valid UTF-8 at byte offset ")
    assert result.stderr.removeprefix(
        "error: results member is not valid UTF-8 at byte offset ").strip().isdigit()


@pytest.mark.parametrize("command_name", ["inventory", "mesas"])
def test_year_mismatch_scans_excluded_rows(tmp_path, command_name):
    path, digest = archive(tmp_path, {"results.csv": payload([
        row(year="2017"), row(year="2019", distrito="3"), row(year="2017")])})
    result = invoke(path, digest, *(["--cargo", "CONCEJALES"] if command_name == "mesas" else []),
                    command_name=command_name)
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
