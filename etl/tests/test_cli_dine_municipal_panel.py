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


def panel_inputs(tmp_path):
    elections = []
    for year, cargo, proxy in [(2019, "INTENDENTE", True), (2021, "CONCEJALES", False)]:
        folder = tmp_path / str(year)
        folder.mkdir()
        rows = [mesa_row(year=str(year), cargo=cargo),
                mesa_row(year=str(year), cargo=cargo, mesa="2"),
                mesa_row(year=str(year), cargo=cargo, mesa="3"),
                mesa_row(year=str(year), cargo=cargo, mesa="3"),
                mesa_row(year=str(year), cargo="OTHER")]
        path, digest = archive(folder, {"results.csv": payload(rows)})
        elections.append(dict(year=year, archive=str(path.relative_to(tmp_path)),
                              expected_sha256=digest, cargo=cargo, proxy=proxy,
                              proxy_note="Declared synthetic proxy" if proxy else None))
    curated = tmp_path / "curated"
    curated.mkdir()
    return curated / "inputs.json", dict(schema_version=1, distrito="02", seccion="027",
                                         target_category="CONCEJALES", elections=elections)


def invoke_panel(path, data):
    path.write_text(json.dumps(data), encoding="utf-8")
    return invoke(None, None, "panel", "--inputs", str(path))


def test_panel_two_years(tmp_path):
    path, inputs = panel_inputs(tmp_path)
    result = invoke_panel(path, inputs)
    assert result.returncode == 0, result.stderr
    data = json.loads(result.stdout)
    assert data["inputs_sha256"] == hashlib.sha256(path.read_bytes()).hexdigest()
    assert data["schema_version"] == 1
    assert (data["distrito"], data["seccion"], data["target_category"]) == ("02", "027", "CONCEJALES")
    assert [e["year"] for e in data["elections"]] == [2019, 2021]
    for election, declared, summary in zip(data["elections"], inputs["elections"], data["summary"]):
        assert election["is_proxy"] is declared["proxy"]
        assert election["proxy_for"] == ("CONCEJALES" if declared["proxy"] else None)
        assert election["proxy_note"] == declared["proxy_note"]
        for mesa in election["mesas"] + election["quarantined_mesas"]:
            assert mesa["is_proxy"] is declared["proxy"]
            assert mesa["observed_cargo"] == declared["cargo"]
        assert election["source"]["archive_sha256"] == declared["expected_sha256"]
        assert summary == dict(year=declared["year"], mesas=2, electores=200, positivo=10,
                              quarantined_mesas=1,
                              excluded_rows_by_reason=election["excluded_rows_by_reason"])
        assert summary["excluded_rows_by_reason"]["other_cargo"] == 1


@pytest.mark.parametrize("change", [
    "schema", "order", "duplicate", "false_cargo", "true_cargo", "note", "sha",
    "year_bool", "proxy_type", "absolute", "escape", "extra", "empty", "false_note",
    "district_type", "section_type", "target_type", "elections_type", "archive_type"])
def test_panel_invalid_inputs(tmp_path, change):
    path, data = panel_inputs(tmp_path)
    first, second = data["elections"]
    if change == "schema": data["schema_version"] = True
    elif change == "order": second["year"] = 2017
    elif change == "duplicate": second["year"] = first["year"]
    elif change == "false_cargo": second["cargo"] = "INTENDENTE"
    elif change == "true_cargo": first["cargo"] = "CONCEJALES"
    elif change == "note": del first["proxy_note"]
    elif change == "sha": first["expected_sha256"] = "z" * 64
    elif change == "year_bool": first["year"] = True
    elif change == "proxy_type": first["proxy"] = 1
    elif change == "absolute": first["archive"] = "/input.zip"
    elif change == "escape": first["archive"] = "../input.zip"
    elif change == "extra": data["unknown"] = 1
    elif change == "empty": data["elections"] = []
    elif change == "false_note": second["proxy_note"] = "not allowed"
    elif change == "district_type": data["distrito"] = 2
    elif change == "section_type": data["seccion"] = None
    elif change == "target_type": data["target_category"] = ""
    elif change == "elections_type": data["elections"] = {}
    elif change == "archive_type": first["archive"] = None
    result = invoke_panel(path, data)
    assert result.returncode == 2
    assert result.stdout == ""
    assert result.stderr.startswith("error: invalid inputs: ")


@pytest.mark.parametrize("failure", ["sha", "member", "year", "utf8"])
def test_panel_year_failure_aborts(tmp_path, failure):
    path, data = panel_inputs(tmp_path)
    election = data["elections"][1]
    if failure == "sha":
        election["expected_sha256"] = "0" * 64
        message = "archive sha256 mismatch:"
    else:
        members = {"results.csv": payload([mesa_row(year="2019")])}
        message = "row year mismatch:"
        if failure == "member":
            members = {}
            message = "expected exactly one results member,"
        elif failure == "utf8":
            members = {"results.csv": b"\xff\n"}
            message = "results member is not valid UTF-8 at byte offset"
        _, election["expected_sha256"] = archive(tmp_path / "2021", members)
    result = invoke_panel(path, data)
    assert result.returncode == 2
    assert result.stdout == ""
    assert result.stderr.startswith("error: year 2021: " + message)
