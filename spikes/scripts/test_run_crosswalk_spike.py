"""Subprocess coverage for the isolated crosswalk SPIKE entry point."""

from __future__ import annotations

import csv
import json
import subprocess
import sys
from pathlib import Path

import pytest
from etl.crosswalk import (
    FISCALIZACION_VOTE_COLUMNS,
    OFFICIAL_AGRUPACION_NAME_BY_COLUMN,
    OFFICIAL_VOTOS_TIPO_BY_COLUMN,
)
from run_crosswalk_spike import load_official_vectors

SCRIPT = Path(__file__).with_name("run_crosswalk_spike.py")
OFFICIAL_SCOPE = {
    "año": 2025,
    "eleccion_tipo": "GENERALES",
    "distrito_id": "02",
    "seccion_id": "027",
    "cargo_nombre": "DIPUTADO NACIONAL",
}


def _local_csv(path: Path, rows: list[dict[str, str | int]]) -> None:
    with path.open("w", newline="", encoding="utf-8") as fixture:
        writer = csv.DictWriter(
            fixture,
            fieldnames=[
                "Nombre",
                "Apellido",
                "Escuela",
                "Mesa",
                *FISCALIZACION_VOTE_COLUMNS,
            ],
        )
        writer.writeheader()
        writer.writerows(rows)


def _votes(value: int = 0) -> dict[str, int]:
    return {column: value for column in FISCALIZACION_VOTE_COLUMNS}


def _complete_official_rows(mesa_order: tuple[str, ...]) -> list[dict[str, str | int]]:
    rows = []
    for mesa_id in mesa_order:
        rows.extend(
            {
                **OFFICIAL_SCOPE,
                "mesa_id": mesa_id,
                "agrupacion_nombre": agrupacion,
                "votos_tipo": "POSITIVO",
                "votos_cantidad": 0,
            }
            for agrupacion in OFFICIAL_AGRUPACION_NAME_BY_COLUMN.values()
        )
        rows.extend(
            {
                **OFFICIAL_SCOPE,
                "mesa_id": mesa_id,
                "agrupacion_nombre": OFFICIAL_AGRUPACION_NAME_BY_COLUMN[
                    "La Libertad Avanza"
                ],
                "votos_tipo": votos_tipo,
                "votos_cantidad": 0,
            }
            for votos_tipo in OFFICIAL_VOTOS_TIPO_BY_COLUMN.values()
        )
    return rows


def _official_row(**overrides: object) -> dict[str, object]:
    return {
        **OFFICIAL_SCOPE,
        "mesa_id": "1",
        "agrupacion_nombre": OFFICIAL_AGRUPACION_NAME_BY_COLUMN["La Libertad Avanza"],
        "votos_tipo": "POSITIVO",
        "votos_cantidad": 0,
        **overrides,
    }


def _load_official(tmp_path: Path, payload: object):
    official = tmp_path / "official.json"
    official.write_text(json.dumps(payload), encoding="utf-8")
    return load_official_vectors(official)


def _run(fiscalizacion: Path, official: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [
            sys.executable,
            str(SCRIPT),
            "--fiscalizacion",
            str(fiscalizacion),
            "--official-json",
            str(official),
        ],
        capture_output=True,
        check=False,
        text=True,
    )


def test_cli_refuses_invalid_utf8_official_input(tmp_path):
    fiscalizacion = tmp_path / "local.csv"
    _local_csv(fiscalizacion, [{"Escuela": "A", "Mesa": "Mesa 1", **_votes()}])
    official = tmp_path / "official.json"
    official.write_bytes(b"RAW_BYTES_SENTINEL\xff")

    result = _run(fiscalizacion, official)
    output = result.stdout + result.stderr

    assert result.returncode == 2
    assert "official_schema_refusal" in output
    assert "Traceback" not in output
    assert "RAW_BYTES_SENTINEL" not in output


def test_cli_refuses_oversized_official_mesa_without_echo(tmp_path):
    fiscalizacion = tmp_path / "local.csv"
    _local_csv(fiscalizacion, [{"Escuela": "A", "Mesa": "Mesa 1", **_votes()}])
    sentinel = "9" * 100_000
    official = tmp_path / "official.json"
    official.write_text(json.dumps([_official_row(mesa_id=sentinel)]), encoding="utf-8")

    result = _run(fiscalizacion, official)
    output = result.stdout + result.stderr

    assert result.returncode == 2
    assert "malformed_official_mesa_id" in output
    assert sentinel not in output
    assert len(output) < 2_000


def test_loader_projects_personal_columns_before_public_result(tmp_path, capsys):
    from run_crosswalk_spike import load_fiscalizacion_vectors

    fiscalizacion = tmp_path / "local.csv"
    first_name, last_name = "NOMBRE_SENTINEL", "APELLIDO_SENTINEL"
    _local_csv(
        fiscalizacion,
        [
            {
                "Nombre": first_name,
                "Apellido": last_name,
                "Escuela": "School",
                "Mesa": "Mesa 1",
                **_votes(),
            }
        ],
    )

    result = load_fiscalizacion_vectors(fiscalizacion)
    official = tmp_path / "official.json"
    official.write_text(json.dumps(_complete_official_rows(("1",))), encoding="utf-8")
    subprocess_result = _run(fiscalizacion, official)

    captured = capsys.readouterr()
    output = (
        captured.out
        + captured.err
        + subprocess_result.stdout
        + subprocess_result.stderr
    )
    assert first_name not in repr(result)
    assert last_name not in repr(result)
    assert first_name not in output
    assert last_name not in output


def test_loader_reuses_production_continuation_and_quarantine_reasons(tmp_path):
    from run_crosswalk_spike import load_fiscalizacion_vectors

    fiscalizacion = tmp_path / "local.csv"
    split = _votes()
    split[FISCALIZACION_VOTE_COLUMNS[0]] = ""
    continuation = _votes()
    continuation.update({column: "" for column in FISCALIZACION_VOTE_COLUMNS[1:]})
    _local_csv(
        fiscalizacion,
        [
            {"Escuela": "A", "Mesa": "Mesa 1", **split},
            {"Escuela": "A", "Mesa": "", **continuation},
            {"Escuela": "B", "Mesa": "Mesa 2", **_votes()},
            {"Escuela": "other", "Mesa": "", **continuation},
            {"Escuela": "C", "Mesa": "Mesa 3", **_votes()},
            {"Escuela": "C", "Mesa": "", **_votes()},
            {"Escuela": "D", "Mesa": "not a mesa", **_votes()},
            {"Escuela": "D", "Mesa": "", **continuation},
        ],
    )

    result = load_fiscalizacion_vectors(fiscalizacion)

    assert result.vectors == (
        ("1", (0,) * len(FISCALIZACION_VOTE_COLUMNS)),
        ("2", (0,) * len(FISCALIZACION_VOTE_COLUMNS)),
        ("3", (0,) * len(FISCALIZACION_VOTE_COLUMNS)),
    )
    assert [
        (problem.reason, problem.mesa_id, problem.source_row_index)
        for problem in result.problems
    ] == [
        ("unmergeable_empty_mesa", None, 3),
        ("unmergeable_empty_mesa", None, 5),
        ("unreadable_mesa", None, 6),
        ("unmergeable_empty_mesa", None, 7),
    ]


def test_loader_refuses_incomplete_local_vectors(tmp_path):
    from run_crosswalk_spike import load_fiscalizacion_vectors

    fiscalizacion = tmp_path / "local.csv"
    blank, unreadable = _votes(), _votes()
    blank[FISCALIZACION_VOTE_COLUMNS[0]] = ""
    unreadable[FISCALIZACION_VOTE_COLUMNS[1]] = "not-a-number"
    _local_csv(
        fiscalizacion,
        [
            {"Escuela": "A", "Mesa": "Mesa 1", **blank},
            {"Escuela": "A", "Mesa": "Mesa 2", **unreadable},
        ],
    )

    result = load_fiscalizacion_vectors(fiscalizacion)

    assert result.vectors == ()
    assert [
        (problem.reason, problem.mesa_id, problem.source_row_index)
        for problem in result.problems
    ] == [
        ("incomplete_local_vector", "1", 0),
        ("incomplete_local_vector", "2", 1),
    ]


def test_cli_reports_bounded_duplicate_problems_from_production_parser(tmp_path):
    fiscalizacion = tmp_path / "local.csv"
    incomplete = _votes()
    incomplete[FISCALIZACION_VOTE_COLUMNS[0]] = ""
    _local_csv(
        fiscalizacion,
        [
            {
                "Nombre": "PRIVATE_RAW_SENTINEL",
                "Escuela": "A",
                "Mesa": "Mesa 1",
                **_votes(index),
            }
            for index in range(7)
        ]
        + [{"Escuela": "A", "Mesa": "Mesa 2", **incomplete}],
    )
    official = tmp_path / "official.json"
    official.write_text(json.dumps(_complete_official_rows(("1",))), encoding="utf-8")

    result = _run(fiscalizacion, official)

    assert result.returncode == 1
    assert result.stdout == (
        "local mesas parsed (usable): 0\n"
        "--- local input problems ---\n"
        "duplicate_conflict: 7 problem(s)\n"
        "  mesa 1, source row 0\n"
        "  mesa 1, source row 1\n"
        "  mesa 1, source row 2\n"
        "  mesa 1, source row 3\n"
        "  mesa 1, source row 4\n"
        "  omitted 2 additional problem(s)\n"
        "incomplete_local_vector: 1 problem(s)\n"
        "  mesa 2, source row 7\n"
        "terminal verdict: REFUSED\n"
    )
    assert "vector-distance matching:" not in result.stdout
    assert "PRIVATE_RAW_SENTINEL" not in result.stdout


def test_cli_reports_deterministic_ambiguity_from_trusted_official_input(tmp_path):
    fiscalizacion = tmp_path / "local.csv"
    _local_csv(fiscalizacion, [{"Escuela": "A", "Mesa": "Mesa 1", **_votes()}])

    outputs = []
    for mesa_order in (("2", "3"), ("3", "2")):
        official = tmp_path / f"official-{'-'.join(mesa_order)}.json"
        official.write_text(
            json.dumps(_complete_official_rows(mesa_order)), encoding="utf-8"
        )
        result = _run(fiscalizacion, official)

        assert result.returncode == 1
        outputs.append(result.stdout)

    assert outputs[0] == outputs[1]
    assert "  ambiguities: 1\n    ('1', ('2', '3'))\n" in outputs[0]
    assert "official validation pending PR2b" not in outputs[0]
    assert "  terminal verdict: BLOCKED" in outputs[0]


@pytest.mark.parametrize(
    ("field", "bad_value"),
    [
        ("año", 2024),
        ("eleccion_tipo", "PASO"),
        ("distrito_id", "03"),
        ("seccion_id", "026"),
        ("cargo_nombre", "SENADOR NACIONAL"),
    ],
)
def test_cli_refuses_each_official_scope_mismatch(tmp_path, field, bad_value):
    fiscalizacion = tmp_path / "local.csv"
    _local_csv(fiscalizacion, [{"Escuela": "A", "Mesa": "Mesa 1", **_votes()}])
    rows = _complete_official_rows(("1",))
    for row in rows:
        row[field] = bad_value
    official = tmp_path / "official.json"
    official.write_text(json.dumps(rows), encoding="utf-8")

    result = _run(fiscalizacion, official)

    assert result.returncode == 2
    assert "official_scope_mismatch: 17 problem(s)" in result.stdout


@pytest.mark.parametrize(
    ("payload", "reason"),
    [
        ({}, "official_schema_refusal"),
        ([{"mesa_id": "1"}], "official_schema_refusal"),
        *[
            ([_official_row(mesa_id=value)], "malformed_official_mesa_id")
            for value in (1, 1.5, True, None, " ", " 1", "١", "1A", "00000")
        ],
    ],
)
def test_official_loader_refuses_schema_and_nontext_mesa_ids(tmp_path, payload, reason):
    result = _load_official(tmp_path, payload)

    assert result.vectors == ()
    assert result.problems[0].reason == reason
    assert result.problems[0].mesa_id is None


def test_official_loader_accepts_maximum_textual_mesa_id(tmp_path):
    result = _load_official(tmp_path, _complete_official_rows(("99999",)))

    assert result.vectors == (("99999", (0,) * len(FISCALIZACION_VOTE_COLUMNS)),)
    assert result.problems == ()


@pytest.mark.parametrize(
    ("value", "reason"),
    [
        (None, "missing_official_quantity"),
        ("", "missing_official_quantity"),
        (True, "malformed_official_quantity"),
        (1.5, "malformed_official_quantity"),
        ("nope", "malformed_official_quantity"),
        (-1, "negative_official_quantity"),
        (0, None),
        ("0", None),
    ],
)
def test_official_loader_classifies_quantities_without_coercion(
    tmp_path, value, reason
):
    result = _load_official(tmp_path, [_official_row(votos_cantidad=value)])

    assert {problem.reason for problem in result.problems} == (
        {reason, "incomplete_official_vector"}
        if reason
        else {"incomplete_official_vector"}
    )


def test_official_loader_refuses_unmappable_duplicate_and_incomplete_rows(tmp_path):
    rows = _complete_official_rows(("1",))
    rows.extend(
        [
            _official_row(agrupacion_nombre="PRIVATE_UNEXPECTED_PARTY"),
            _official_row(votos_tipo="INVALID_TYPE"),
            _official_row(),
        ]
    )
    rows.pop(1)
    result = _load_official(tmp_path, rows)

    assert result.vectors == ()
    assert {problem.reason for problem in result.problems} == {
        "duplicate_official_dimension_conflict",
        "incomplete_official_vector",
        "unmappable_official_row",
    }


def test_cli_bounds_and_stabilizes_official_refusal_output(tmp_path):
    fiscalizacion = tmp_path / "local.csv"
    _local_csv(fiscalizacion, [{"Escuela": "A", "Mesa": "Mesa 1", **_votes()}])
    quantity_sentinel = "9" * 100_000
    rows = [
        _official_row(mesa_id=str(index), agrupacion_nombre="PRIVATE_SENTINEL")
        for index in range(1, 8)
    ]
    rows.append(_official_row(mesa_id="8", votos_cantidad=quantity_sentinel))
    outputs = []
    for ordered in (rows, list(reversed(rows))):
        official = tmp_path / f"official-{len(outputs)}.json"
        official.write_text(json.dumps(ordered), encoding="utf-8")
        result = _run(fiscalizacion, official)
        assert result.returncode == 2
        outputs.append(result.stdout)

    assert outputs[0] == outputs[1]
    assert "unmappable_official_row: 7 problem(s)" in outputs[0]
    assert "malformed_official_quantity: 1 problem(s)" in outputs[0]
    assert "omitted 2 additional problem(s)" in outputs[0]
    assert "PRIVATE_SENTINEL" not in outputs[0]
    assert quantity_sentinel not in outputs[0]
    assert "Traceback" not in outputs[0]
    assert len(outputs[0]) < 2_000


def test_cli_passes_only_complete_unambiguous_trusted_vectors(tmp_path):
    fiscalizacion = tmp_path / "local.csv"
    _local_csv(fiscalizacion, [{"Escuela": "A", "Mesa": "Mesa 1", **_votes()}])
    official = tmp_path / "official.json"
    official.write_text(json.dumps(_complete_official_rows(("1",))), encoding="utf-8")

    result = _run(fiscalizacion, official)

    assert result.returncode == 0
    assert "terminal verdict: PASS" in result.stdout


def test_cli_refuses_local_problems_without_matcher_verdict(tmp_path):
    fiscalizacion = tmp_path / "local.csv"
    incomplete = _votes()
    incomplete[FISCALIZACION_VOTE_COLUMNS[0]] = ""
    _local_csv(fiscalizacion, [{"Escuela": "A", "Mesa": "Mesa 1", **incomplete}])
    official = tmp_path / "official.json"
    official.write_text(json.dumps(_complete_official_rows(("1",))), encoding="utf-8")

    result = _run(fiscalizacion, official)

    assert result.returncode == 1
    assert "incomplete_local_vector: 1 problem(s)" in result.stdout
    assert "vector-distance matching:" not in result.stdout
    assert "terminal verdict: REFUSED" in result.stdout
