"""Subprocess coverage for the isolated crosswalk SPIKE entry point."""

from __future__ import annotations

import csv
import json
import subprocess
import sys
from pathlib import Path

from run_crosswalk_spike import (
    FISCALIZACION_VOTE_COLUMNS,
    OFFICIAL_AGRUPACION_BY_COLUMN,
    OFFICIAL_VOTOS_TIPO_BY_COLUMN,
)

SCRIPT = Path(__file__).with_name("run_crosswalk_spike.py")


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
            for agrupacion in OFFICIAL_AGRUPACION_BY_COLUMN.values()
        )
        rows.extend(
            {
                "mesa_id": mesa_id,
                "agrupacion_nombre": OFFICIAL_AGRUPACION_BY_COLUMN[
                    "La Libertad Avanza"
                ],
                "votos_tipo": votos_tipo,
                "votos_cantidad": 0,
            }
            for votos_tipo in OFFICIAL_VOTOS_TIPO_BY_COLUMN.values()
        )
    return rows


def test_cli_reports_deterministic_ambiguity_without_external_inputs(tmp_path):
    fiscalizacion = tmp_path / "local.csv"
    with fiscalizacion.open("w", newline="", encoding="utf-8") as fixture:
        writer = csv.DictWriter(
            fixture, fieldnames=["Mesa", *FISCALIZACION_VOTE_COLUMNS]
        )
        writer.writeheader()
        writer.writerow(
            {"Mesa": "Mesa 1", **{column: 0 for column in FISCALIZACION_VOTE_COLUMNS}}
        )

    outputs = []
    for mesa_order in (("z", "a"), ("a", "z")):
        official = tmp_path / f"official-{'-'.join(mesa_order)}.json"
        official.write_text(
            json.dumps(_complete_official_rows(mesa_order)), encoding="utf-8"
        )
        result = subprocess.run(
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

        assert result.returncode == 1
        outputs.append(result.stdout)

    assert outputs[0] == outputs[1]
    assert "  ambiguities: 1\n    ('1', ('a', 'z'))\n" in outputs[0]
    assert "  terminal verdict: BLOCKED" in outputs[0]
