"""Read-only reconciliation through the real main, archive SHA boundary and PDF decoder."""

import hashlib
import io
import json
from pathlib import Path

import pytest
import yaml
from pypdf import PdfWriter
from pypdf.generic import DecodedStreamObject, DictionaryObject, NameObject

from etl.__main__ import main

YEARS = (2015, 2017, 2019, 2021, 2023, 2025)


def pdf_bytes(lines):
    writer = PdfWriter()
    page = writer.add_blank_page(width=612, height=792)
    font = DictionaryObject({NameObject("/Type"): NameObject("/Font"),
                             NameObject("/Subtype"): NameObject("/Type1"),
                             NameObject("/BaseFont"): NameObject("/Helvetica")})
    page[NameObject("/Resources")] = DictionaryObject({
        NameObject("/Font"): DictionaryObject({NameObject("/F1"): writer._add_object(font)})
    })
    stream = DecodedStreamObject()
    escaped = [line.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)") for line in lines]
    stream.set_data(("BT /F1 10 Tf 40 750 Td 14 TL\n" +
                     "\n".join(f"({line}) Tj T*" for line in escaped) + "\nET").encode("latin1"))
    page[NameObject("/Contents")] = writer._add_object(stream)
    result = io.BytesIO()
    writer.write(result)
    return result.getvalue()


def positioned_pdf_bytes(label_x, rows, summaries):
    """Model verified separate label/vote/percent text-show operations per baseline."""
    writer = PdfWriter()
    page = writer.add_blank_page(width=612, height=842)
    font = DictionaryObject({NameObject("/Type"): NameObject("/Font"),
                             NameObject("/Subtype"): NameObject("/Type1"),
                             NameObject("/BaseFont"): NameObject("/Helvetica")})
    page[NameObject("/Resources")] = DictionaryObject({
        NameObject("/Font"): DictionaryObject({NameObject("/F1"): writer._add_object(font)})
    })
    operations = []

    def show(x, y, text):
        escaped = text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
        operations.append(f"BT /F1 12 Tf 1 0 0 1 {x} {y} Tm ({escaped}) Tj ET")

    show(label_x, 818, "Lista Votos %")
    shift = label_x - 21
    for index, (label, votes, percent) in enumerate(rows):
        y = 798 - 20 * index
        show(label_x, y, label)
        show(403.30 + shift, y, votes)
        show(489.98 + shift, y, percent)
    for index, summary in enumerate(summaries):
        show(label_x, 798 - 20 * (len(rows) + index), summary)
    stream = DecodedStreamObject()
    stream.set_data("\n".join(operations).encode("latin1"))
    page[NameObject("/Contents")] = writer._add_object(stream)
    result = io.BytesIO()
    writer.write(result)
    return result.getvalue()


def replace_case_pdf(archive_case, data):
    args, manifest, root, record, _ = archive_case
    (root / record["archived_path"]).write_bytes(data)
    record["sha256"] = hashlib.sha256(data).hexdigest()
    repin_sources(args, record["sha256"])
    manifest.write_text(json.dumps([record]))
    return args


@pytest.mark.parametrize("label_x", [21, 41])
def test_real_main_pairs_positioned_operands_without_pre_hyphen_space(
    archive_case, capsys, label_x,
):
    data = positioned_pdf_bytes(label_x, [
        ("901- ANON GROUP A", "1.234", "60,20"),
        ("902- ANON GROUP B", "816", "39,80"),
    ], ["VOTOS POSITIVOS 2.050 90,00", "TOTAL DE MESAS 154"])
    args = replace_case_pdf(archive_case, data)
    assert main(args) == 1  # Five other sources deliberately absent.
    output = capsys.readouterr()
    assert output.err == ""
    source = json.loads(output.out)["sources"][0]
    extraction = source["extraction"]
    assert extraction["list_rows"] == [
        {"page": 1, "list_id": "901", "group_name": "ANON GROUP A",
         "printed_votes": 1234, "printed_percent": "60,20"},
        {"page": 1, "list_id": "902", "group_name": "ANON GROUP B",
         "printed_votes": 816, "printed_percent": "39,80"},
    ]
    assert extraction["unparsed_table_rows"] == 0
    assert "table_rows_unparsed" not in source["uncertainties"]
    assert "list_table_empty" not in source["uncertainties"]
    assert extraction["category"] is None and source["round"] == "unverified"
    assert source["council_series_accepted"] is False


@pytest.mark.parametrize("label", [
    "BLANCO", "VOTOS EN BLANCO", "VOTO EN BLANCO", "EN BLANCO", "VOTO BLANCO",
])
def test_real_main_recognizes_only_whitelisted_blank_labels(archive_case, capsys, label):
    data = positioned_pdf_bytes(41, [("901- ANON GROUP A", "2.050", "100,00")], [
        "VOTOS POSITIVOS 2.050 90,00", f"{label} 215 9,44",
        "TOTAL DE VOTOS 2.277 100,00", "TOTAL DE MESAS 154",
    ])
    args = replace_case_pdf(archive_case, data)
    assert main(args) == 1
    output = capsys.readouterr()
    assert output.err == ""
    source = json.loads(output.out)["sources"][0]
    extraction = source["extraction"]
    if label == "VOTO BLANCO":
        assert extraction["fields"]["blank_votes"] is None
        assert "printed_field_missing:blank_votes" in source["uncertainties"]
    else:
        assert extraction["fields"]["blank_votes"] == 215
        assert {"field": "blank_votes", "page": 1, "label": label,
                "printed_value": "215"} in extraction["field_evidence"]
        assert "printed_field_missing:blank_votes" not in source["uncertainties"]
    # Even a nonzero residual cannot supply an absent printed null field.
    assert extraction["fields"]["null_votes"] is None
    assert "printed_field_missing:null_votes" in source["uncertainties"]


@pytest.mark.parametrize("blank_value,reason", [
    ("215", "printed_field_repeated:blank_votes"),
    ("216", "printed_field_conflicting:blank_votes"),
])
def test_real_main_keeps_strict_suffix_and_ambiguous_evidence(
    archive_case, capsys, blank_value, reason,
):
    data = positioned_pdf_bytes(21, [
        ("901- ANON GROUP A", "1.234", "60,20"),
        ("901 -ANON GROUP B", "816", "39,80"),
        ("902- ANON GROUP C", "12,34", "1,00"),
        ("903- ANON GROUP D", "100", "1.00"),
        ("904- ANON GROUP E", "100", "1,00 EXTRA"),
        ("905- WRAPPED GROUP", "", ""),
        ("CONTINUATION", "100", "1,00"),
    ], ["VOTOS POSITIVOS 2.050 90,00", "VOTO EN BLANCO 215 9,44",
        f"VOTOS EN BLANCO {blank_value} 9,44", "TOTAL DE MESAS 154"])
    args = replace_case_pdf(archive_case, data)
    assert main(args) == 1
    output = capsys.readouterr()
    assert output.err == ""
    report = json.loads(output.out)
    source = report["sources"][0]
    extraction = source["extraction"]
    assert extraction["list_rows"] == [
        {"page": 1, "list_id": "901", "group_name": "ANON GROUP A",
         "printed_votes": 1234, "printed_percent": "60,20"},
        {"page": 1, "list_id": "901", "group_name": "ANON GROUP B",
         "printed_votes": 816, "printed_percent": "39,80"},
    ]
    assert extraction["unparsed_table_rows"] == 5
    assert extraction["fields"]["blank_votes"] is None
    assert [e["printed_value"] for e in extraction["field_evidence"]
            if e["field"] == "blank_votes"] == ["215", blank_value]
    for diagnostic in ("list_id_repeated", "table_rows_unparsed", reason):
        assert diagnostic in source["uncertainties"]
        assert report["uncertainty_counts"][diagnostic] == 1


@pytest.fixture
def archive_case(tmp_path):
    root = tmp_path / "archive"
    (root / "pba").mkdir(parents=True)
    data = pdf_bytes(["Lista Votos %", "135 - PUBLIC GROUP 1.234 50,00",
                      "VOTOS POSITIVOS 2.468 90,00", "TOTAL DE MESAS 144"])
    digest = hashlib.sha256(data).hexdigest()
    filename = f"2015027-{digest}.pdf"
    (root / "pba" / filename).write_bytes(data)
    entries = [{"id": f"pba/{year}-resultados-027", "election_year": year,
                "election_round": "unverified", "mime": "application/pdf",
                "expected_sha256": digest,
                "source": "example.invalid", "notes": "Synthetic public evidence",
                "source_url": f"https://example.invalid/{year}.pdf"} for year in YEARS]
    sources = tmp_path / "sources.yaml"
    sources.write_text(yaml.safe_dump({"pba": entries}))
    manifest = tmp_path / "manifest.json"
    record = {"id": entries[0]["id"], "status": "ok", "capability": "pba",
              "sha256": digest, "archived_path": f"pba/{filename}",
              "election_year": 2015, "election_round": "unverified",
              "source_kind": "official", "mime": "application/pdf",
              "source_url": "https://example.invalid/2015.pdf"}
    manifest.write_text(json.dumps([record]))
    args = ["--sources-path", str(sources), "--local-root", str(root),
            "--manifest-path", str(manifest), "reconcile-pba-pdf-evidence"]
    return args, manifest, root, record, data


def repin_sources(args, digest):
    path = Path(args[1])
    sources = yaml.safe_load(path.read_text())
    for entry in sources["pba"]:
        entry["expected_sha256"] = digest
    path.write_text(yaml.safe_dump(sources))


@pytest.mark.parametrize("location,field,value,reason", [
    ("registry", "expected_sha256", "0" * 64, "archive_pin_mismatch"),
    ("registry", "expected_sha256", None, "registry_pin_missing"),
    ("registry", "expected_sha256", "invalid", "registry_pin_malformed"),
    ("registry", "election_year", 2017, "registry_invalid"),
    ("registry", "mime", "text/csv", "registry_provenance_mismatch:mime"),
    ("registry", "source_kind", "fiscalizacion", "registry_provenance_mismatch:source_kind"),
    ("manifest", "source_url", "https://example.invalid/other.pdf",
     "archive_provenance_mismatch:source_url"),
    ("manifest", "election_year", 2017, "archive_provenance_mismatch:election_year"),
    ("manifest", "election_round", "generales", "archive_provenance_mismatch:election_round"),
    ("manifest", "mime", "text/csv", "archive_provenance_mismatch:mime"),
    ("manifest", "source_kind", "fiscalizacion", "archive_provenance_mismatch:source_kind"),
    ("manifest", "capability", "national", "archive_provenance_mismatch:capability"),
    ("manifest", "source_url", None, "manifest_provenance_missing:source_url"),
    ("manifest", "election_year", None, "manifest_provenance_missing:election_year"),
    ("manifest", "source_kind", None, "manifest_provenance_missing:source_kind"),
    ("manifest", "mime", None, "manifest_provenance_missing:mime"),
    ("manifest", "election_round", None, "manifest_provenance_missing:election_round"),
    ("manifest", "capability", None, "manifest_provenance_missing:capability"),
    ("manifest", "election_year", True, "manifest_malformed"),
    ("manifest", "election_year", "2015", "manifest_malformed"),
    ("manifest", "source_url", [], "manifest_malformed"),
    ("manifest", "mime", " ", "manifest_provenance_malformed:mime"),
    ("manifest", "source_kind", 123, "manifest_malformed"),
])
def test_real_main_refuses_unpinned_or_conflicting_provenance(
    archive_case, capsys, location, field, value, reason,
):
    args, manifest, root, record, _ = archive_case
    path = Path(args[1])
    sources = yaml.safe_load(path.read_text())
    target = sources["pba"][0] if location == "registry" else record
    if value is None:
        target.pop(field, None)
    else:
        target[field] = value
    path.write_text(yaml.safe_dump(sources))
    manifest.write_text(json.dumps([record]))
    before = {p: p.read_bytes() for p in [path, manifest, *root.rglob("*.pdf")]}
    assert main(args) == 1
    output = capsys.readouterr()
    if reason == "registry_invalid":
        assert "id declares year 2015" in output.err
        assert output.out == ""
        assert {p: p.read_bytes() for p in before} == before
        return
    assert output.err == ""
    report = json.loads(output.out)
    assert len(report["sources"]) == 6
    source = report["sources"][0]
    assert source["status"] == reason
    assert source["digest"]["verified"] is False
    assert source["source_kind"] is None
    assert source["extraction"] is None
    assert report["failure_counts"] == (
        {reason: 6} if reason == "manifest_malformed" else
        {reason: 1, "manifest_record_missing": 5}
    )
    assert {p: p.read_bytes() for p in before} == before


@pytest.mark.parametrize("unsafe_path", [
    "pba/C:example.pdf", "archive/pba/c:example.pdf", "pba/C:/example.pdf",
    r"pba/C:\example.pdf", r"pba/\\server\share\example.pdf", "pba//example.pdf",
    "archive-extra/pba/example.pdf", "pba-extra/example.pdf", "pba/   ",
])
def test_real_main_reports_unsafe_path_and_continues(archive_case, capsys, unsafe_path):
    args, manifest, root, record, _ = archive_case
    records = [{**record, "id": f"pba/{year}-resultados-027", "election_year": year,
                "source_url": f"https://example.invalid/{year}.pdf"} for year in YEARS]
    records[0]["archived_path"] = unsafe_path
    manifest.write_text(json.dumps(records))
    before = {p: p.read_bytes() for p in [manifest, *root.rglob("*.pdf")]}
    assert main(args) == 1
    output = capsys.readouterr()
    assert output.err == ""
    report = json.loads(output.out)
    assert [s["year"] for s in report["sources"]] == [2015, 2017, 2019, 2021, 2023, 2025]
    assert report["sources"][0]["status"] == "archive_path_unsafe"
    assert report["sources"][0]["digest"]["verified"] is False
    assert report["sources"][0]["extraction"] is None
    assert all(s["status"] == "extracted" for s in report["sources"][1:])
    assert report["failure_counts"] == {"archive_path_unsafe": 1}
    assert {p: p.read_bytes() for p in before} == before


def test_real_main_accepts_normalized_pins_and_registered_official_default(archive_case, capsys):
    args, manifest, _, record, _ = archive_case
    path = Path(args[1])
    sources = yaml.safe_load(path.read_text())
    sources["pba"][0]["expected_sha256"] = record["sha256"].upper()
    sources["pba"][0]["election_round"] = " unverified "
    path.write_text(yaml.safe_dump(sources))
    record["sha256"] = record["sha256"].upper()
    record["election_round"] = " unverified "
    manifest.write_text(json.dumps([record]))
    assert main(args) == 1  # Other five artifacts are absent, not this source.
    output = capsys.readouterr()
    assert output.err == ""
    source = json.loads(output.out)["sources"][0]
    assert source["status"] == "extracted"
    assert source["source_kind"] == "official"
    assert source["digest"]["verified"] is True
    assert source["year"] == 2015 and source["round"] == "unverified"


def test_real_main_malformed_duplicate_cannot_match_known_html(archive_case, capsys):
    from test_cli_pba_html_evidence import HTML_ID, html_bytes

    args, manifest, root, record, _ = archive_case
    replace_case_pdf(archive_case, pdf_bytes([
        "Lista Votos %", "901 - PUBLIC GROUP A 32.291 100,00",
        "VOTOS POSITIVOS 32.291 93,76", "TOTAL DE ELECTORES 52.755",
        "TOTAL DE ELECTORES SYNTHETIC_UNREADABLE",
    ]))
    record.update(id="pba/2025-resultados-027", election_year=2025,
                  source_url="https://example.invalid/2025.pdf")
    registry = Path(args[1])
    sources = yaml.safe_load(registry.read_text())
    data = html_bytes()
    digest = hashlib.sha256(data).hexdigest()
    (root / "pba/integrated.html").write_bytes(data)
    entry = {"id": HTML_ID, "election_year": 2025, "election_round": "provinciales",
             "mime": "text/html", "expected_sha256": digest, "source_kind": "official",
             "source": "example.invalid", "notes": "Synthetic public evidence",
             "source_url": "https://example.invalid/integrated.html"}
    sources["pba"].append(entry)
    registry.write_text(yaml.safe_dump(sources))
    manifest.write_text(json.dumps([record, {
        **entry, "status": "ok", "capability": "pba", "sha256": digest,
        "archived_path": "pba/integrated.html",
    }]))
    before = {p: p.read_bytes() for p in [registry, manifest, *root.rglob("*")]
              if p.is_file()}
    assert main([*args, "--include-html"]) == 1
    output = capsys.readouterr()
    assert output.err == ""
    report = json.loads(output.out)
    source = report["sources"][-1]
    assert source["status"] == "extracted" and source["digest"]["verified"] is True
    assert source["extraction"]["fields"]["total_electors"] is None
    assert report["reconciliation"]["pdf_integrated"]["fields"]["total_electors"] == {
        "status": "unknown", "pdf": None, "html": 52755,
    }
    reason = "printed_field_malformed:total_electors"
    assert reason in source["uncertainties"]
    assert report["uncertainty_counts"][reason] == 1
    assert "printed_field_repeated:total_electors" in source["uncertainties"]
    assert source["extraction"]["malformed_field_counts"] == {"total_electors": 1}
    assert "SYNTHETIC_UNREADABLE" not in output.out
    assert {p: p.read_bytes() for p in before} == before


@pytest.mark.parametrize("field,label", [
    ("positive_votes", "VOTOS POSITIVOS"), ("blank_votes", "VOTO EN BLANCO"),
    ("null_votes", "VOTOS NULOS"), ("total_votes", "TOTAL DE VOTOS"),
    ("total_electors", "TOTAL DE ELECTORES"), ("total_mesas", "TOTAL DE MESAS"),
])
@pytest.mark.parametrize("values,reasons,malformed", [
    (["144"], [], 0),
    (["144", "144"], ["repeated"], 0),
    (["144", "145"], ["conflicting"], 0),
    (["SYNTHETIC_UNREADABLE"], ["malformed"], 1),
    (["144", "SYNTHETIC_UNREADABLE"], ["malformed", "repeated"], 1),
    (["SYNTHETIC_UNREADABLE", "144"], ["malformed", "repeated"], 1),
    (["", "144 EXTRA"], ["malformed", "repeated"], 2),
])
def test_real_main_summary_occurrences_never_supply_ambiguous_values(
    archive_case, capsys, field, label, values, reasons, malformed,
):
    lines = ["Lista Votos %", "901 - PUBLIC GROUP A 144 100,00"]
    if field != "positive_votes":
        lines.append("VOTOS POSITIVOS 144 100,00")
    lines.extend(f"{label} {value}" for value in values)
    args = replace_case_pdf(archive_case, pdf_bytes(lines))
    assert main(args) == 1
    output = capsys.readouterr()
    assert output.err == ""
    report = json.loads(output.out)
    source = report["sources"][0]
    assert source["status"] == "extracted" and source["digest"]["verified"] is True
    extraction = source["extraction"]
    assert extraction["fields"][field] == (144 if not reasons else None)
    if malformed:
        assert extraction["malformed_field_counts"] == {field: malformed}
    else:
        assert "malformed_field_counts" not in extraction
    for reason in reasons:
        diagnostic = f"printed_field_{reason}:{field}"
        assert diagnostic in source["uncertainties"]
        assert report["uncertainty_counts"][diagnostic] == 1
    assert f"printed_field_missing:{field}" not in source["uncertainties"]
    assert [e["printed_value"] for e in extraction["field_evidence"] if e["field"] == field] == [
        value for value in values if value in ("144", "145")
    ]
    assert "SYNTHETIC_UNREADABLE" not in output.out
    assert "EXTRA" not in output.out
    assert extraction["list_rows"][0]["printed_votes"] == 144
    assert extraction["unparsed_table_rows"] == 0
    assert source["council_series_accepted"] is False


def test_real_main_reaches_read_only_reconciliation(archive_case, capsys):
    args, *_ = archive_case
    assert main(args) == 1
    report = json.loads(capsys.readouterr().out)
    assert report["read_only"] is True
    assert report["review_required"] is True


def test_verified_pdf_numbers_are_evidence_not_council_series(archive_case, capsys):
    args, manifest, root, *_ = archive_case
    before = {p: p.read_bytes() for p in [manifest, *root.rglob("*.pdf")]}
    assert main(args) == 1
    first = capsys.readouterr().out
    report = json.loads(first)
    assert [s["year"] for s in report["sources"]] == list(YEARS)
    source = report["sources"][0]
    assert source["digest"]["verified"] is True
    assert source["status"] == "extracted"
    assert source["extraction"]["fields"]["total_mesas"] == 144
    assert source["extraction"]["fields"]["positive_votes"] == 2468
    assert source["extraction"]["fields"]["null_votes"] is None
    assert source["extraction"]["list_rows"] == [{
        "page": 1, "list_id": "135", "group_name": "PUBLIC GROUP",
        "printed_votes": 1234, "printed_percent": "50,00",
    }]
    assert source["round"] == "unverified"
    assert source["council_series_accepted"] is False
    assert "category_unverified" in source["uncertainties"]
    assert report["failure_counts"] == {"manifest_record_missing": 5}
    assert report["uncertainty_counts"]["category_unverified"] == 6
    assert main(args) == 1
    assert capsys.readouterr().out == first
    assert {p: p.read_bytes() for p in before} == before
    assert sorted(p.relative_to(root).as_posix() for p in root.rglob("*") if p.is_file()) == [
        next(p for p in before if p != manifest).relative_to(root).as_posix()
    ]


@pytest.mark.parametrize("case,reason", [
    ("non_ok", "manifest_record_non_ok"),
    ("missing_path", "manifest_record_malformed"),
    ("invalid_digest", "manifest_record_malformed"),
    ("unsafe", "archive_path_unsafe"),
    ("absolute", "archive_path_unsafe"),
    ("symlink", "archive_path_unsafe"),
    ("missing_file", "archive_file_missing"),
    ("hash_mismatch", "archive_hash_mismatch"),
    ("truncated", "pdf_parse_failed"),
    ("not_pdf", "pdf_parse_failed"),
    ("duplicate", "manifest_record_duplicate"),
    ("malformed_manifest", "manifest_malformed"),
])
def test_archive_failures_are_distinct_not_silent(archive_case, capsys, case, reason):
    args, manifest, root, record, data = archive_case
    records = [record]
    if case == "non_ok":
        record["status"] = "error"
    elif case == "missing_path":
        record.pop("archived_path")
    elif case == "invalid_digest":
        record["sha256"] = None
    elif case == "unsafe":
        record["archived_path"] = "../pba/hidden.pdf"
    elif case == "absolute":
        record["archived_path"] = str(root / "pba" / "hidden.pdf")
    elif case == "symlink":
        (root / "pba" / "link.pdf").symlink_to(root / record["archived_path"])
        record["archived_path"] = "pba/link.pdf"
    elif case == "missing_file":
        record["archived_path"] = "pba/absent.pdf"
    elif case in {"hash_mismatch", "truncated", "not_pdf"}:
        changed = data + b"changed" if case == "hash_mismatch" else (
            data[:100] if case == "truncated" else b"not a PDF")
        (root / record["archived_path"]).write_bytes(changed)
        if case != "hash_mismatch":
            record["sha256"] = hashlib.sha256(changed).hexdigest()
            repin_sources(args, record["sha256"])
    elif case == "duplicate":
        records.append(dict(record))
    manifest.write_text("{" if case == "malformed_manifest" else json.dumps(records))
    before = {p: p.read_bytes() for p in [manifest, *root.rglob("*.pdf")]}
    assert main(args) == 1
    report = json.loads(capsys.readouterr().out)
    assert report["sources"][0]["status"] == reason
    assert report["sources"][0]["extraction"] is None
    assert report["failure_counts"][reason] == (6 if case == "malformed_manifest" else 1)
    assert {p: p.read_bytes() for p in before} == before


@pytest.mark.parametrize("variant,uncertainty", [
    ("quotient", None),
    ("duplicate_field", "printed_field_conflicting:total_mesas"),
    ("duplicate_list", "list_id_repeated"),
    ("unparsed_row", "table_rows_unparsed"),
    ("no_table", "pdf_layout_unsupported"),
    ("no_end", "pdf_layout_unsupported"),
    ("two_tables", "pdf_layout_unsupported"),
])
def test_printed_layout_preserves_uncertainty(archive_case, capsys, variant, uncertainty):
    args, manifest, root, record, _ = archive_case
    lines = ["Lista Votos %", "135 - PUBLIC GROUP 1.234 50,00",
             "VOTOS POSITIVOS 2.468 90,00", "TOTAL DE MESAS 154",
             "COCIENTE CONCEJALES 274,222222", "COCIENTE CONSEJEROS ESCOLARES 822,666666",
             "CANDIDATE SECTION OMITTED"]
    if variant == "duplicate_field":
        lines.insert(-1, "TOTAL DE MESAS 156")
    elif variant == "duplicate_list":
        lines.insert(2, "135 - OTHER PUBLIC GROUP 999 40,00")
    elif variant == "unparsed_row":
        lines.insert(2, "999 - INCOMPLETE PUBLIC GROUP")
    elif variant == "no_table":
        lines[0] = "Unsupported heading"
    elif variant == "no_end":
        lines[2] = "Unsupported ending"
    elif variant == "two_tables":
        lines.insert(2, "Lista Votos %")
    data = pdf_bytes(lines)
    (root / record["archived_path"]).write_bytes(data)
    record["sha256"] = hashlib.sha256(data).hexdigest()
    repin_sources(args, record["sha256"])
    manifest.write_text(json.dumps([record]))
    assert main(args) == 1
    output = capsys.readouterr().out
    assert "CANDIDATE SECTION" not in output
    source = json.loads(output)["sources"][0]
    if uncertainty == "pdf_layout_unsupported":
        assert source["status"] == uncertainty
        assert source["extraction"] is None
    else:
        assert source["status"] == "extracted"
        assert source["extraction"]["printed_quotients"]["concejales"] == "274,222222"
        assert source["extraction"]["category"] is None
        if uncertainty:
            assert uncertainty in source["uncertainties"]
        if variant == "duplicate_field":
            assert source["extraction"]["fields"]["total_mesas"] is None
        if variant == "duplicate_list":
            assert len(source["extraction"]["list_rows"]) == 2
        if variant == "unparsed_row":
            assert source["extraction"]["unparsed_table_rows"] == 1


def test_six_sources_success_keeps_2025_conflict_unresolved(archive_case, capsys):
    args, manifest, root, record, _ = archive_case
    data = pdf_bytes(["Lista Votos %", "2206 - PUBLIC ALLIANCE 32.291 100,00",
                      "VOTOS POSITIVOS 32.291 93,76", "EN BLANCO 2.150 6,24",
                      "TOTAL DE VOTOS 34.441 65,28", "TOTAL DE ELECTORES 52.755",
                      "TOTAL DE MESAS 154"])
    records = []
    for year in YEARS:
        filename = f"{year}.pdf"
        (root / "pba" / filename).write_bytes(data)
        records.append({**record, "id": f"pba/{year}-resultados-027",
                        "archived_path": f"{root.name}/pba/{filename}",
                        "sha256": hashlib.sha256(data).hexdigest(), "election_year": year,
                        "source_url": f"https://example.invalid/{year}.pdf"})
    repin_sources(args, hashlib.sha256(data).hexdigest())
    manifest.write_text(json.dumps(records))
    assert main(args) == 0
    report = json.loads(capsys.readouterr().out)
    assert report["failure_counts"] == {}
    assert len(report["sources"]) == 6
    conflict = report["sources"][-1]["coverage_comparison"]
    assert conflict == {"pdf_total_mesas": 154, "previously_documented_html_total_mesas": 156,
                        "previously_documented_html_counted_mesas": 156,
                        "html_verified_by_command": False, "status": "unresolved"}
    assert "coverage_discrepancy_unresolved" in report["sources"][-1]["uncertainties"]
    assert report["review_required"] is True


@pytest.mark.parametrize("variant,reason", [
    ("missing", "registry_source_missing"), ("duplicate", "registry_source_duplicate")
])
def test_registry_never_silently_selects(archive_case, capsys, variant, reason):
    args, *_ = archive_case
    path = Path(args[1])
    entries = yaml.safe_load(path.read_text())["pba"]
    entries = entries[1:] if variant == "missing" else [*entries, entries[0]]
    path.write_text(yaml.safe_dump({"pba": entries}))
    assert main(args) == 1
    report = json.loads(capsys.readouterr().out)
    assert report["sources"][0]["status"] == reason
    assert report["failure_counts"][reason] == 1
