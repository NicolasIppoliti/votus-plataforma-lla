"""Subprocess coverage for the isolated crosswalk SPIKE entry point."""

from __future__ import annotations

import csv
import json
import subprocess
import sys
from pathlib import Path

from etl.crosswalk import (
    FISCALIZACION_VOTE_COLUMNS,
    OFFICIAL_AGRUPACION_NAME_BY_COLUMN,
    OFFICIAL_VOTOS_TIPO_BY_COLUMN,
)

SCRIPT = Path(__file__).with_name("run_crosswalk_spike.py")


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
                "mesa_id": mesa_id,
                "agrupacion_nombre": agrupacion,
                "votos_tipo": "POSITIVO",
                "votos_cantidad": 0,
            }
            for agrupacion in OFFICIAL_AGRUPACION_NAME_BY_COLUMN.values()
        )
        rows.extend(
            {
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


def test_cli_reports_deterministic_ambiguity_but_refuses_pending_official_validation(
    tmp_path,
):
    fiscalizacion = tmp_path / "local.csv"
    _local_csv(fiscalizacion, [{"Escuela": "A", "Mesa": "Mesa 1", **_votes()}])

    outputs = []
    for mesa_order in (("z", "a"), ("a", "z")):
        official = tmp_path / f"official-{'-'.join(mesa_order)}.json"
        official.write_text(
            json.dumps(_complete_official_rows(mesa_order)), encoding="utf-8"
        )
        result = _run(fiscalizacion, official)

        assert result.returncode == 2
        outputs.append(result.stdout)

    assert outputs[0] == outputs[1]
    assert "  ambiguities: 1\n    ('1', ('a', 'z'))\n" in outputs[0]
    assert "official validation pending PR2b" in outputs[0]
    assert "  terminal verdict: REFUSED" in outputs[0]


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
