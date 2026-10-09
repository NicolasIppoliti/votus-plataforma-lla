"""The shared administrative-code boundary preserves existing semantics."""

from pathlib import Path
import subprocess
import sys

import pytest

from etl import admin_codes, jurisdiction


@pytest.mark.parametrize("name,width", [
    ("normalize_distrito_code", 2),
    ("normalize_seccion_code", 3),
    ("normalize_pba_distrito_code", 3),
])
def test_numeric_padding(name, width):
    normalize = getattr(admin_codes, name)
    assert normalize(" 2 ") == "2".zfill(width)
    assert normalize("0002") == "2".zfill(width)
    assert normalize("123456") == "123456"
    assert normalize(None) is None


@pytest.mark.parametrize("raw", [None, 2, "", " ", "2_7", "-2", "+2", "2.0", "٢", "²", "2AB", "2é"])
def test_invalid_codes_pass_through(raw):
    assert not admin_codes.is_canonicalizable_code(raw)
    assert not admin_codes.is_canonicalizable_circuito_code(raw)
    for name in ("normalize_distrito_code", "normalize_seccion_code",
                 "normalize_pba_distrito_code", "normalize_circuito_code"):
        assert getattr(admin_codes, name)(raw) == raw


@pytest.mark.parametrize("raw,expected", [
    ("1", "00001"), ("00001", "00001"), (" 1a ", "0001A"),
    ("0001A", "0001A"), ("123456", "123456"), ("12345b", "12345B"),
    ("000001", "000001"),
])
def test_circuito_padding_and_suffix(raw, expected):
    assert admin_codes.is_canonicalizable_circuito_code(raw)
    assert admin_codes.normalize_circuito_code(raw) == expected


def test_jurisdiction_reexports_identical_callables():
    for name in ("normalize_distrito_code", "normalize_seccion_code",
                 "normalize_pba_distrito_code", "normalize_circuito_code",
                 "is_canonicalizable_code", "is_canonicalizable_circuito_code"):
        assert getattr(jurisdiction, name) is getattr(admin_codes, name)


def test_import_without_site_packages():
    etl_dir = Path(__file__).resolve().parents[1]
    result = subprocess.run([
        sys.executable,
        "-S", "-B", "-c",
        f"import sys; sys.path.insert(0, {str(etl_dir)!r}); import etl.admin_codes",
    ], capture_output=True, text=True)
    assert result.returncode == 0, result.stdout + result.stderr
