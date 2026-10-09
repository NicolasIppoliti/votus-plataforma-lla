"""HTML evidence through the real read-only CLI and verified archive boundary."""

import hashlib
import json
from pathlib import Path

import pytest
import yaml
from test_cli_pba_pdf_evidence import YEARS, pdf_bytes

from etl.__main__ import main

HTML_ID = "pba/2025-distrito-027"


def html_bytes(*, rows="", details="", header="Concejales Titulares", percent="Porcentaje"):
    return f"""<!doctype html><html><body>
<div class="detail-group"><span class="detail-label">Electores habilitados</span>
<span class="detail-value">52.755</span></div>
<div class="detail-group"><span class="detail-label">Total de mesas</span>
<span class="detail-value">156</span></div>
<div class="detail-group"><span class="detail-label">Mesas escrutadas</span>
<span class="detail-value">156</span></div>{details}
<table class="data-table input-table"><thead><tr><th>Lista</th><th>Partidos políticos</th>
<th>Diputados Prov. Tit.</th><th>Porcentaje</th><th>{header}</th><th>{percent}</th>
</tr></thead><tbody>
<tr><td>901</td><td>PUBLIC GROUP A</td><td>100</td><td>0.32 %</td>
<td><b>20.000</b></td><td><b>61.94 %</b></td></tr>
<tr><td>902</td><td>PUBLIC GROUP B</td><td>31.390</td><td>99.68 %</td>
<td>12.291</td><td>38.06 %</td></tr>
<tr><td>903</td><td>PROVINCE ONLY</td><td>0</td><td>0 %</td>
<td>-</td><td><b>-</b></td></tr>{rows}
<tr><td></td><td>VOTOS POSITIVOS</td><td>31.490</td><td>91.43 %</td>
<td>32.291</td><td>93.76 %</td></tr>
<tr><td></td><td>VOTO EN BLANCO</td><td>2.951</td><td>8.57 %</td>
<td>2.150</td><td>6.24 %</td></tr>
</tbody><tfoot><tr><td></td><td><b>Total de votos</b></td><td>34.441</td><td>65.28 %</td>
<td>34.441</td><td><b>65.28</b> %</td></tr></tfoot></table></body></html>""".encode()


@pytest.fixture
def html_case(tmp_path):
    root = tmp_path / "archive"
    (root / "pba").mkdir(parents=True)
    sources, records = [], []

    def add(source_id, data, mime, year, round_):
        digest = hashlib.sha256(data).hexdigest()
        name = source_id.split("/")[1] + (".html" if mime == "text/html" else ".pdf")
        (root / "pba" / name).write_bytes(data)
        source = {
            "id": source_id,
            "election_year": year,
            "election_round": round_,
            "mime": mime,
            "expected_sha256": digest,
            "source": "example.invalid",
            "source_kind": "official",
            "notes": "Synthetic public evidence",
            "source_url": f"https://example.invalid/{name}",
        }
        sources.append(source)
        records.append(
            {
                **source,
                "status": "ok",
                "capability": "pba",
                "sha256": digest,
                "archived_path": f"pba/{name}",
            }
        )

    for year in YEARS:
        add(
            f"pba/{year}-resultados-027",
            pdf_bytes(
                [
                    "Lista Votos %",
                    "901 - PUBLIC GROUP A 20.000 61,94",
                    "902 - PUBLIC GROUP B 12.291 38,06",
                    "VOTOS POSITIVOS 32.291 93,76",
                    "VOTO EN BLANCO 2.150 6,24",
                    "TOTAL DE VOTOS 34.441 100,00",
                    "TOTAL DE ELECTORES 52.755",
                    "TOTAL DE MESAS 154",
                ]
            ),
            "application/pdf",
            year,
            "unverified",
        )
    add(HTML_ID, html_bytes(), "text/html", 2025, "provinciales")
    for suffix in ("argentinos", "extranjeros"):
        add(f"{HTML_ID}-{suffix}", html_bytes(), "text/html", 2025, "provinciales")
    registry, manifest = tmp_path / "sources.yaml", tmp_path / "manifest.json"
    registry.write_text(yaml.safe_dump({"pba": sources}))
    manifest.write_text(json.dumps(records))
    args = [
        "--sources-path",
        str(registry),
        "--local-root",
        str(root),
        "--manifest-path",
        str(manifest),
        "reconcile-pba-pdf-evidence",
        "--include-html",
    ]

    def replace(data, *, repin=True):
        record = next(item for item in records if item["id"] == HTML_ID)
        (root / record["archived_path"]).write_bytes(data)
        if repin:
            digest = hashlib.sha256(data).hexdigest()
            record["sha256"] = digest
            next(item for item in sources if item["id"] == HTML_ID)["expected_sha256"] = digest
            registry.write_text(yaml.safe_dump({"pba": sources}))
            manifest.write_text(json.dumps(records))

    return args, replace


def report_html(html_case, capsys, data=None):
    args, replace = html_case
    if data is not None:
        replace(data)
    result = main(args)
    captured = capsys.readouterr()
    assert result in (0, 1)
    assert captured.err == ""
    report = json.loads(captured.out)
    item = next(source for source in report["html_sources"] if source["source_id"] == HTML_ID)
    return item, report


def test_real_main_reads_html_fields_and_category_adjacent_percentages(html_case, capsys):
    item, report = report_html(html_case, capsys)
    assert len(report["sources"]) == 6
    extraction = item["extraction"]
    assert extraction["category"] == "CONCEJALES"
    assert extraction["fields"] == {
        "positive_votes": 32291,
        "blank_votes": 2150,
        "null_votes": None,
        "total_votes": 34441,
        "total_electors": 52755,
        "total_mesas": 156,
        "counted_mesas": 156,
    }
    assert [
        (row["list_id"], row["printed_votes"], row["printed_percent"])
        for row in extraction["list_rows"]
    ] == [("901", 20000, "61.94"), ("902", 12291, "38.06")]
    assert all(
        row["printed_percent_denominator"] == "positive_votes" for row in extraction["list_rows"]
    )
    assert extraction["exclusions_by_reason"] == {"category_not_contested": 1}
    assert "printed_field_missing:null_votes" in item["uncertainties"]
    evidence = {field["field"]: field for field in extraction["field_evidence"]}
    assert evidence["positive_votes"]["printed_percent"] == "93.76"
    assert evidence["positive_votes"]["percent_denominator"] == "total_votes"
    assert evidence["total_votes"]["printed_percent"] == "65.28"
    assert evidence["total_votes"]["percent_denominator"] == "total_electors"
    assert all(field["label"] and field["location"] for field in evidence.values())


@pytest.mark.parametrize(
    "value,reason",
    [
        ("2.150", "printed_field_repeated:blank_votes"),
        ("2.151", "printed_field_conflicting:blank_votes"),
    ],
)
def test_real_main_does_not_pick_repeated_summary(html_case, capsys, value, reason):
    duplicate = (
        "<tr><td></td><td>VOTO EN BLANCO</td><td>0</td><td>0 %</td>"
        f"<td>{value}</td><td>6.24 %</td></tr>"
    )
    item, _ = report_html(html_case, capsys, html_bytes(rows=duplicate))
    assert item["extraction"]["fields"]["blank_votes"] is None
    assert reason in item["uncertainties"]
    assert (
        len(
            [
                field
                for field in item["extraction"]["field_evidence"]
                if field["field"] == "blank_votes"
            ]
        )
        == 2
    )


@pytest.mark.parametrize(
    "header,percent,reason",
    [
        (
            "Concejales Titulares</th><th>Porcentaje</th><th>Concejales Titulares",
            "Porcentaje",
            "html_category_header_repeated",
        ),
        ("Concejales Titulares", "Participación", "html_category_percent_header_missing"),
        ("Intendente", "Porcentaje", "html_category_header_missing"),
    ],
)
def test_real_main_refuses_ambiguous_category_headers(
    html_case,
    capsys,
    header,
    percent,
    reason,
):
    item, _ = report_html(html_case, capsys, html_bytes(header=header, percent=percent))
    extraction = item["extraction"]
    assert extraction["category"] is None
    assert extraction["fields"]["positive_votes"] is None
    assert extraction["list_rows"] == []
    assert reason in item["uncertainties"]


def test_real_main_preserves_repeated_list_ids(html_case, capsys):
    duplicate = (
        "<tr><td>901</td><td>PUBLIC GROUP C</td><td>0</td><td>0 %</td>"
        "<td>1</td><td>0.00 %</td></tr>"
    )
    item, _ = report_html(html_case, capsys, html_bytes(rows=duplicate))
    assert [row["list_id"] for row in item["extraction"]["list_rows"]] == ["901", "902", "901"]
    assert "list_id_repeated" in item["uncertainties"]


@pytest.mark.parametrize(
    "replacement,reason",
    [
        ("<td>not-an-integer</td>", "list_vote_malformed"),
        ("<td><td>20.000</td></td>", "html_row_structure_malformed"),
        ('<td colspan="2">20.000</td>', "html_row_structure_malformed"),
    ],
)
def test_real_main_surfaces_malformed_cells_without_zero(html_case, capsys, replacement, reason):
    data = html_bytes().replace(b"<td><b>20.000</b></td>", replacement.encode())
    item, _ = report_html(html_case, capsys, data)
    assert [row["list_id"] for row in item["extraction"]["list_rows"]] == ["902"]
    assert item["extraction"]["exclusions_by_reason"][reason] == 1
    assert "table_rows_unparsed" in item["uncertainties"]


def test_real_main_refuses_unclosed_html_table(html_case, capsys):
    item, _ = report_html(html_case, capsys, html_bytes().replace(b"</table>", b""))
    assert item["extraction"]["category"] is None
    assert item["extraction"]["fields"]["positive_votes"] is None
    assert item["extraction"]["fields"]["total_electors"] == 52755
    assert "html_structure_malformed" in item["uncertainties"]


def test_real_main_refuses_html_archive_hash_mismatch(html_case, capsys):
    args, replace = html_case
    replace(html_bytes(rows="<tr><td>tampered</td></tr>"), repin=False)
    assert main(args) == 1
    output = capsys.readouterr()
    assert output.err == ""
    item = next(
        source
        for source in json.loads(output.out)["html_sources"]
        if source["source_id"] == HTML_ID
    )
    assert item["status"] == "archive_hash_mismatch"
    assert item["digest"]["verified"] is False
    assert item["extraction"] is None


def test_real_main_reads_verified_public_html_fixture(html_case, capsys):
    fixture = Path(__file__).parent / "fixtures" / "pba_distrito_027_2025_sample.html"
    item, _ = report_html(html_case, capsys, fixture.read_bytes())
    extraction = item["extraction"]
    assert item["digest"]["verified"] is True
    assert extraction["category"] == "CONCEJALES"
    assert len(extraction["list_rows"]) == 8
    assert sum(row["printed_votes"] for row in extraction["list_rows"]) == 32291
    assert extraction["fields"]["blank_votes"] == 2150
    assert extraction["fields"]["total_votes"] == 34441
    assert extraction["fields"]["total_electors"] == 52755
    assert extraction["fields"]["total_mesas"] == extraction["fields"]["counted_mesas"] == 156
    assert extraction["fields"]["null_votes"] is None
    assert extraction["exclusions_by_reason"] == {"category_not_contested": 8}
    assert extraction["unparsed_table_rows"] == 0


@pytest.mark.parametrize(
    "replacement",
    [
        '<th colspan="2">Concejales Titulares</th>',
        '<th rowspan="2">Concejales Titulares</th>',
        "<th><th>Concejales Titulares</th></th>",
    ],
)
def test_real_main_refuses_malformed_category_header(html_case, capsys, replacement):
    data = html_bytes().replace(b"<th>Concejales Titulares</th>", replacement.encode())
    item, _ = report_html(html_case, capsys, data)
    assert item["extraction"]["category"] is None
    assert item["extraction"]["fields"]["positive_votes"] is None
    assert "html_header_row_malformed" in item["uncertainties"]


def test_real_main_blocks_fields_from_ambiguous_detail_group(html_case, capsys):
    details = """<div class="detail-group">
<span class="detail-label">Electores habilitados</span>
<span class="detail-label">Total de mesas</span>
<span class="detail-value">156</span></div>"""
    item, _ = report_html(html_case, capsys, html_bytes(details=details))
    extraction = item["extraction"]
    for field in ("total_electors", "total_mesas"):
        assert extraction["fields"][field] is None
        assert f"printed_field_ambiguous:{field}" in item["uncertainties"]
        ambiguous = next(
            evidence
            for evidence in extraction["field_evidence"]
            if evidence["field"] == field and evidence.get("binding") == "ambiguous"
        )
        assert ambiguous["printed_labels"] == ["Electores habilitados", "Total de mesas"]
        assert ambiguous["printed_values"] == ["156"]
        assert ambiguous["printed_value"] is None


def test_real_main_preserves_all_repeated_detail_values(html_case, capsys):
    details = """<div class="detail-group"><span class="detail-label">Electores habilitados</span>
<span class="detail-value">52.755</span><span class="detail-value">52.756</span></div>"""
    item, _ = report_html(html_case, capsys, html_bytes(details=details))
    assert item["extraction"]["fields"]["total_electors"] is None
    assert "printed_field_conflicting:total_electors" in item["uncertainties"]
    assert [
        evidence["printed_value"]
        for evidence in item["extraction"]["field_evidence"]
        if evidence["field"] == "total_electors"
    ] == ["52.755", "52.755", "52.756"]


def test_real_main_refuses_truncated_detail_after_valid_table(html_case, capsys):
    details = (
        b'<div class="detail-group"><span class="detail-label">Electores habilitados</span>'
        b'<span class="detail-value">52.755</span>'
    )
    item, _ = report_html(html_case, capsys, html_bytes() + details)
    assert item["extraction"]["fields"]["total_electors"] is None
    assert "printed_field_ambiguous:total_electors" in item["uncertainties"]
    assert item["extraction"]["category"] == "CONCEJALES"


@pytest.mark.parametrize("old,new", [("Lista", "Personas"), ("Partidos políticos", "Candidatos")])
def test_real_main_requires_public_list_identity_headers(html_case, capsys, old, new):
    data = html_bytes().replace(f"<th>{old}</th>".encode(), f"<th>{new}</th>".encode())
    item, _ = report_html(html_case, capsys, data)
    assert item["extraction"]["category"] is None
    assert item["extraction"]["list_rows"] == []
    assert "html_identity_header_unsupported" in item["uncertainties"]


def test_real_main_does_not_echo_unreadable_detail_text(html_case, capsys):
    details = """<div class="detail-group"><span class="detail-label">Electores habilitados</span>
<span class="detail-value">UNREADABLE VALUE</span></div>"""
    item, _ = report_html(html_case, capsys, html_bytes(details=details))
    assert item["extraction"]["fields"]["total_electors"] is None
    assert "UNREADABLE VALUE" not in json.dumps(item)
