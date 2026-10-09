"""Earlier layouts through main, verified archive bytes and the PDF decoder."""

import hashlib
import io
import json

import pytest
import yaml
from pypdf import PdfReader, PdfWriter
from test_cli_pba_pdf_evidence import pdf_bytes

from etl.__main__ import main

YEARS = (2011, 2013, 2015, 2017, 2019, 2021, 2023, 2025)
CONTINUATION = [
    "ANON PERSON ALPHA; CONCEJALES SUPLENTES:",
    "ANON PERSON BETA; CONSEJEROS ESCOLARES TITULARES:",
    "ANON PERSON GAMMA; CONSEJEROS ESCOLARES SUPLENTES:",
    "ANON PERSON DELTA;",
]


def first_page(null_label="NULOS", *, candidate_start=True):
    lines = [
        "Lista Votos %",
        "901 - ANON GROUP A 60 60,00",
        "902 - ANON GROUP B 40 40,00",
        "VOTOS POSITIVOS 100 90,09",
        "VOTO EN BLANCO 10 9,01",
        f"{null_label} 1 0,90",
        "TOTAL DE VOTOS 111",
        "TOTAL DE ELECTORES 200",
        "TOTAL DE MESAS 2",
        "COCIENTE CONCEJALES 11,111111",
        "COCIENTE CONSEJEROS ESCOLARES 33,333333",
    ]
    if candidate_start:
        lines.append("RESULTARON ELECTOS: CONCEJALES TITULARES: ANON GROUP A:")
    return lines


def archive_case(tmp_path, *, year=2013, pages=None):
    writer = PdfWriter()
    for lines in pages or [first_page(), CONTINUATION]:
        reader = PdfReader(io.BytesIO(pdf_bytes(lines)))
        writer.add_page(reader.pages[0])
    stream = io.BytesIO()
    writer.write(stream)
    data = stream.getvalue()
    digest = hashlib.sha256(data).hexdigest()
    root = tmp_path / "archive"
    (root / "pba").mkdir(parents=True)
    filename = f"{year}027-{digest}.pdf"
    body = root / "pba" / filename
    body.write_bytes(data)
    entries = [
        {
            "id": f"pba/{candidate}-resultados-027",
            "election_year": candidate,
            "election_round": "unverified",
            "mime": "application/pdf",
            "expected_sha256": digest,
            "source": "example.invalid",
            "source_url": f"https://example.invalid/{candidate}.pdf",
            "notes": "Anonymous synthetic municipal evidence",
        }
        for candidate in YEARS
    ]
    registry = tmp_path / "sources.yaml"
    registry.write_text(yaml.safe_dump({"pba": entries}))
    record = {
        "id": f"pba/{year}-resultados-027",
        "status": "ok",
        "capability": "pba",
        "sha256": digest,
        "archived_path": f"pba/{filename}",
        "election_year": year,
        "election_round": "unverified",
        "source_kind": "official",
        "mime": "application/pdf",
        "source_url": f"https://example.invalid/{year}.pdf",
    }
    manifest = tmp_path / "manifest.json"
    manifest.write_text(json.dumps([record]))
    args = [
        "--sources-path",
        str(registry),
        "--local-root",
        str(root),
        "--manifest-path",
        str(manifest),
        "reconcile-pba-pdf-evidence",
        "--include-earlier",
    ]
    return args, registry, manifest, body, record


def report_case(case, capsys):
    args, *paths, record = case
    before = {path: path.read_bytes() for path in paths}
    assert main(args) == 1  # Seven deliberately missing source artifacts remain visible.
    output = capsys.readouterr()
    assert output.err == ""
    assert "ANON PERSON" not in output.out
    assert {path: path.read_bytes() for path in paths} == before
    report = json.loads(output.out)
    source = next(item for item in report["sources"] if item["source_id"] == record["id"])
    return source, report


def test_real_main_reads_only_2013_first_page_numbers_and_reports_continuation(tmp_path, capsys):
    source, report = report_case(archive_case(tmp_path), capsys)
    assert source["status"] == "extracted"
    assert source["digest"]["verified"] is True and source["source_kind"] == "official"
    extraction = source["extraction"]
    assert extraction["page_count"] == 2
    assert extraction["fields"] == {
        "positive_votes": 100,
        "blank_votes": 10,
        "null_votes": 1,
        "total_votes": 111,
        "total_electors": 200,
        "total_mesas": 2,
    }
    assert extraction["exclusions_by_reason"] == {"candidate_section_continuation": 4}
    assert [row["printed_votes"] for row in extraction["list_rows"]] == [60, 40]
    assert all(row["page"] == 1 for row in extraction["list_rows"])
    assert all(field["page"] == 1 for field in extraction["field_evidence"])
    assert extraction["unparsed_table_rows"] == 0
    assert extraction["category"] is None and source["round"] == "unverified"
    assert source["council_series_accepted"] is False
    assert report["failure_counts"] == {"manifest_record_missing": 7}


def test_real_main_reads_2013_entire_candidate_section_from_second_page(tmp_path, capsys):
    # The pin-checked official PDF has all candidate headings on page two,
    # with eighteen nonempty lines, no numerical fields and no table there.
    second = [
        "RESULTARON ELECTOS: CONCEJALES TITULARES: ANON GROUP A:",
        *CONTINUATION,
        *(f"ANON PERSON {letter};" for letter in "ABCDEFGHIJKLM"),
    ]
    case = archive_case(tmp_path, pages=[first_page(candidate_start=False), second])
    source, _ = report_case(case, capsys)
    assert source["status"] == "extracted"
    extraction = source["extraction"]
    assert extraction["page_count"] == 2
    assert extraction["exclusions_by_reason"] == {"candidate_section_continuation": 18}
    assert extraction["fields"]["positive_votes"] == 100
    assert [row["printed_votes"] for row in extraction["list_rows"]] == [60, 40]
    assert extraction["category"] is None and source["council_series_accepted"] is False


def test_real_main_refuses_duplicate_candidate_start_across_2013_pages(tmp_path, capsys):
    second = ["RESULTARON ELECTOS: CONCEJALES TITULARES: ANON GROUP A:", *CONTINUATION]
    source, _ = report_case(archive_case(tmp_path, pages=[first_page(), second]), capsys)
    assert source["status"] == "pdf_layout_unsupported"
    assert source["extraction"] is None


@pytest.mark.parametrize(
    "label,known",
    [
        ("VOTO NULO", True),
        ("VOTOS NULOS", True),
        ("NULOS", True),
        ("VOTOS NULO", False),
        ("VOTO NULOS", False),
    ],
)
def test_real_main_recognizes_2011_singular_null_without_fuzzy_label_repair(
    tmp_path,
    capsys,
    label,
    known,
):
    source, _ = report_case(archive_case(tmp_path, year=2011, pages=[first_page(label)]), capsys)
    assert source["status"] == "extracted"
    assert source["extraction"]["fields"]["null_votes"] == (1 if known else None)
    assert ("printed_field_missing:null_votes" in source["uncertainties"]) is not known
    if known:
        assert {"field": "null_votes", "page": 1, "label": label, "printed_value": "1"} in source[
            "extraction"
        ]["field_evidence"]


@pytest.mark.parametrize(
    "tail",
    [
        ["Lista Votos %", "903 - ANON GROUP C 99 99,00"],
        ["VOTOS POSITIVOS 101"],
        ["VOTOS POSITIVOS", "101"],
        ["COCIENTE CONCEJALES 12,00"],
        ["903 - ANON GROUP C 99 99,00"],
        ["Lista Votos %"],
        ["VOTO NULO"],
        ["UNKNOWN COUNT 55"],
    ],
)
def test_real_main_refuses_hidden_numeric_or_table_content_on_2013_second_page(
    tmp_path,
    capsys,
    tail,
):
    source, report = report_case(
        archive_case(tmp_path, pages=[first_page(), [*CONTINUATION, *tail]]), capsys
    )
    assert source["status"] == "pdf_layout_unsupported"
    assert source["extraction"] is None and source["digest"]["verified"] is True
    assert report["failure_counts"]["pdf_layout_unsupported"] == 1


@pytest.mark.parametrize(
    "year,pages",
    [
        (2011, [first_page(), CONTINUATION]),
        (2015, [first_page(), CONTINUATION]),
        (2013, [first_page(), CONTINUATION, CONTINUATION]),
        (2013, [first_page(candidate_start=False), CONTINUATION]),
        (2013, [first_page(), []]),
        (2013, [first_page(), ["UNRECOGNIZED CONTINUATION"]]),
    ],
)
def test_real_main_keeps_other_multipage_or_unbounded_layouts_unsupported(
    tmp_path,
    capsys,
    year,
    pages,
):
    source, _ = report_case(archive_case(tmp_path, year=year, pages=pages), capsys)
    assert source["status"] == "pdf_layout_unsupported"
    assert source["extraction"] is None


@pytest.mark.parametrize("failure", ["pin", "kind", "bytes"])
def test_real_main_verifies_earlier_archive_before_allowing_layout(tmp_path, capsys, failure):
    case = archive_case(tmp_path)
    _, registry, manifest, body, record = case
    if failure == "pin":
        sources = yaml.safe_load(registry.read_text())
        next(entry for entry in sources["pba"] if entry["id"] == record["id"])[
            "expected_sha256"
        ] = "0" * 64
        registry.write_text(yaml.safe_dump(sources))
        reason = "archive_pin_mismatch"
    elif failure == "kind":
        record["source_kind"] = "fiscalizacion"
        manifest.write_text(json.dumps([record]))
        reason = "archive_provenance_mismatch:source_kind"
    else:
        body.write_bytes(body.read_bytes() + b"changed")
        reason = "archive_hash_mismatch"
    source, _ = report_case(case, capsys)
    assert source["status"] == reason
    assert source["extraction"] is None and source["digest"]["verified"] is False
