"""Expected mesa universe and per-category count status (T3-0a, S6).

Fixtures use the exact headers of the hash-matching 2025 ZIP
(`archive/national/2025-legislativas.zip`, spikes/001 (a)) with a handful of
synthetic rows. Measured shape of the real file (2026-10-12): the catalogue has
108,992 unique mesa keys, no duplicates, all NATIVOS; `estado_final` is
`ESCRUTADO` or `NO ESCRUTADO`, never mixed within one (cargo, mesa). The 2023
files have neither the catalogue nor `estado_final`.
"""

from __future__ import annotations

import io

from etl.ingest.national import (
    ExpectedMesa,
    MesaCountStatus,
    build_national_completeness,
)

RESULTS_HEADER = (
    "año,eleccion_tipo,recuento_tipo,padron_tipo,distrito_id,distrito_nombre,"
    "seccionprovincial_id,seccionprovincial_nombre,seccion_id,seccion_nombre,circuito_id,"
    "circuito_nombre,mesa_id,mesa_tipo,mesa_electores,cargo_id,cargo_nombre,agrupacion_id,"
    "agrupacion_nombre,lista_numero,lista_nombre,votos_tipo,votos_cantidad,estado_final,"
    "eleccion_id,recuento_id\n"
)
CATALOGUE_HEADER = (
    "año,eleccion_tipo,recuento_tipo,distrito_id,distrito_nombre,seccion_id,seccion_nombre,"
    "localvotacion_codigo,localvotacion_nombre,localvotacion_direccion,localvotacion_localidad,"
    "localvotacion_cp,localvotacion_geolat,localvotacion_geolng,mesa_id,mesa_electores,mesa_tipo\n"
)


def _result(
    mesa: int, cargo: str, votos_tipo: str, votos: int, estado: str, circuito: str = "00011"
) -> str:
    return (
        f"2025,GENERAL,PROVISORIO,COMUN,02,BUENOS AIRES,6,Sección Sexta,027,"
        f"CORONEL DE MARINA L. ROSALES,{circuito},,{mesa},NATIVOS,300,3,{cargo},"
        f"{'135' if votos_tipo == 'POSITIVO' else ''},LA LIBERTAD AVANZA,,,{votos_tipo},{votos},"
        f"{estado},1,1\n"
    )


def _catalogue(mesa: str, electores: str = "300", tipo: str = "NATIVOS") -> str:
    return (
        f"2025,GENERAL,PROVISORIO,02,BUENOS AIRES,027,CORONEL DE MARINA L. ROSALES,37974,"
        f"ESCUELA,CALLE 1,PUNTA ALTA,8109,-38.8,-62.0,{mesa},{electores},{tipo}\n"
    )


def _build(results: str, catalogue: str | None):
    return build_national_completeness(
        io.StringIO(RESULTS_HEADER + results),
        establecimientos_csv_bytes=None
        if catalogue is None
        else (CATALOGUE_HEADER + catalogue).encode(),
        source_label="national/test",
    )


def test_counted_and_not_counted_status_per_category_and_mesa() -> None:
    completeness = _build(
        _result(1, "DIPUTADO NACIONAL", "POSITIVO", 120, "ESCRUTADO")
        + _result(1, "DIPUTADO NACIONAL", "EN BLANCO", 3, "ESCRUTADO")
        + _result(2, "DIPUTADO NACIONAL", "POSITIVO", 0, "NO ESCRUTADO")
        + _result(1, "SENADOR NACIONAL", "POSITIVO", 90, "ESCRUTADO"),
        _catalogue("00001") + _catalogue("00002", electores="310"),
    )

    assert completeness.unavailable_reason is None
    assert completeness.expected == (
        ExpectedMesa("02", "027", 1, "NATIVOS", 300, 0),
        ExpectedMesa("02", "027", 2, "NATIVOS", 310, 1),
    )
    assert completeness.statuses == (
        MesaCountStatus("DIPUTADO NACIONAL", "02", "027", "00011", 1, "counted"),
        MesaCountStatus("DIPUTADO NACIONAL", "02", "027", "00011", 2, "not_counted"),
        MesaCountStatus("SENADOR NACIONAL", "02", "027", "00011", 1, "counted"),
    )
    assert completeness.exclusions == {}


def test_a_mesa_with_no_positive_row_still_gets_a_count_status() -> None:
    # Ingestion keeps only POSITIVO rows; the status pass must read before that filter.
    completeness = _build(
        _result(1, "DIPUTADO NACIONAL", "EN BLANCO", 0, "NO ESCRUTADO"),
        _catalogue("00001"),
    )

    assert completeness.statuses == (
        MesaCountStatus("DIPUTADO NACIONAL", "02", "027", "00011", 1, "not_counted"),
    )


def test_conflicting_or_unrecognized_status_is_quarantined_per_reason_never_picked() -> None:
    completeness = _build(
        _result(1, "DIPUTADO NACIONAL", "POSITIVO", 10, "ESCRUTADO")
        + _result(1, "DIPUTADO NACIONAL", "EN BLANCO", 0, "NO ESCRUTADO")
        + _result(2, "DIPUTADO NACIONAL", "POSITIVO", 10, "definitivo")
        + _result(3, "DIPUTADO NACIONAL", "POSITIVO", 10, "ESCRUTADO", circuito="00011")
        + _result(3, "DIPUTADO NACIONAL", "EN BLANCO", 0, "ESCRUTADO", circuito="00012"),
        _catalogue("00001") + _catalogue("00002") + _catalogue("00003"),
    )

    assert completeness.statuses == ()
    assert [vars(row) for row in completeness.quarantines] == [
        {
            "scope": "status",
            "category": "DIPUTADO NACIONAL",
            "distrito": "02",
            "seccion": "027",
            "mesa": 1,
            "reason": "conflicting estado_final within one category and mesa",
        },
        {
            "scope": "status",
            "category": "DIPUTADO NACIONAL",
            "distrito": "02",
            "seccion": "027",
            "mesa": 2,
            "reason": "unrecognized estado_final",
        },
        {
            "scope": "status",
            "category": "DIPUTADO NACIONAL",
            "distrito": "02",
            "seccion": "027",
            "mesa": 3,
            "reason": "conflicting circuito within one category and mesa",
        },
    ]
    assert completeness.exclusions == {
        "conflicting estado_final within one category and mesa": 1,
        "unrecognized estado_final": 1,
        "conflicting circuito within one category and mesa": 1,
    }


def test_conflicting_catalogue_rows_are_quarantined_and_identical_duplicates_reported() -> None:
    completeness = _build(
        _result(1, "DIPUTADO NACIONAL", "POSITIVO", 10, "ESCRUTADO"),
        _catalogue("00001")
        + _catalogue("00001")
        + _catalogue("00002", electores="300")
        + _catalogue("00002", electores="301")
        + _catalogue("00003", electores="")
        + _catalogue("00004", tipo="OTRO"),
    )

    assert completeness.expected == (ExpectedMesa("02", "027", 1, "NATIVOS", 300, 0),)
    assert [vars(row) for row in completeness.quarantines] == [
        {
            "scope": "catalogue",
            "category": None,
            "distrito": "02",
            "seccion": "027",
            "mesa": 3,
            "reason": "unreadable catalogue mesa_electores",
        },
        {
            "scope": "catalogue",
            "category": None,
            "distrito": "02",
            "seccion": "027",
            "mesa": 4,
            "reason": "unsupported catalogue mesa_tipo",
        },
        {
            "scope": "catalogue",
            "category": None,
            "distrito": "02",
            "seccion": "027",
            "mesa": 2,
            "reason": "conflicting catalogue rows for one mesa",
        },
    ]
    assert completeness.exclusions == {
        "duplicate identical catalogue row": 1,
        "conflicting catalogue rows for one mesa": 1,
        "unreadable catalogue mesa_electores": 1,
        "unsupported catalogue mesa_tipo": 1,
    }


def test_readable_mesas_stay_section_attributed_and_only_unreadable_identities_are_not() -> None:
    completeness = _build(
        _result(1, "", "POSITIVO", 10, "ESCRUTADO")
        + _result(2, "DIPUTADO NACIONAL", "POSITIVO", 10, "ESCRUTADO", circuito="bad")
        + _result(3, "DIPUTADO NACIONAL", "POSITIVO", 10, "ESCRUTADO").replace(",027,", ",x,", 1),
        _catalogue("bad"),
    )
    assert [vars(row) for row in completeness.quarantines] == [
        {
            "scope": "catalogue",
            "category": None,
            "distrito": None,
            "seccion": None,
            "mesa": None,
            "reason": "unreadable catalogue distrito/seccion/mesa identity",
        },
        {
            "scope": "status",
            "category": None,
            "distrito": "02",
            "seccion": "027",
            "mesa": 1,
            "reason": "absent results cargo_nombre",
        },
        {
            "scope": "status",
            "category": "DIPUTADO NACIONAL",
            "distrito": "02",
            "seccion": "027",
            "mesa": 2,
            "reason": "unreadable results circuito",
        },
        {
            "scope": "status",
            "category": "DIPUTADO NACIONAL",
            "distrito": None,
            "seccion": None,
            "mesa": None,
            "reason": "unreadable results distrito/seccion/mesa identity",
        },
    ]


def test_sources_without_catalogue_or_estado_final_have_no_completeness() -> None:
    without_catalogue = _build(_result(1, "DIPUTADO NACIONAL", "POSITIVO", 10, "ESCRUTADO"), None)
    assert without_catalogue.unavailable_reason == "no expected mesa catalogue in source"
    assert without_catalogue.expected == () and without_catalogue.statuses == ()

    legacy_companion = build_national_completeness(
        io.StringIO(RESULTS_HEADER + _result(1, "DIPUTADO NACIONAL", "POSITIVO", 10, "ESCRUTADO")),
        establecimientos_csv_bytes=(
            b"distrito_id,seccion_id,localvotacion_codigo,localvotacion_nombre,mesa_id\n"
            b"2,27,37974,ESCUELA,00001\n"
        ),
        source_label="national/test",
    )
    assert legacy_companion.unavailable_reason == "catalogue lacks mesa_tipo or mesa_electores"

    without_estado = build_national_completeness(
        io.StringIO(
            "distrito_id,seccion_id,circuito_id,mesa_id,cargo_nombre,votos_tipo,votos_cantidad\n"
            "02,027,00011,1,DIPUTADO NACIONAL,POSITIVO,10\n"
        ),
        establecimientos_csv_bytes=(CATALOGUE_HEADER + _catalogue("00001")).encode(),
        source_label="national/test",
    )
    assert without_estado.unavailable_reason == "results source has no estado_final"
    assert without_estado.expected == () and without_estado.statuses == ()


def test_a_header_only_catalogue_stores_no_statuses_or_quarantines() -> None:
    # No expected universe: storing status quarantines would surface them nowhere.
    completeness = _build(
        _result(1, "DIPUTADO NACIONAL", "POSITIVO", 10, "ESCRUTADO")
        + _result(2, "DIPUTADO NACIONAL", "POSITIVO", 10, "definitivo"),
        "",
    )

    assert completeness.unavailable_reason == "expected mesa catalogue has no rows"
    assert completeness.expected == ()
    assert completeness.statuses == ()
    assert completeness.quarantines == ()
