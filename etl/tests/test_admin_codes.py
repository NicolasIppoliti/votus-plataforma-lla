"""The shared administrative-code boundary preserves existing semantics."""

import subprocess
import sys
from pathlib import Path

import pytest

from etl import admin_codes, jurisdiction


@pytest.mark.parametrize(
    "name,width",
    [
        ("normalize_distrito_code", 2),
        ("normalize_seccion_code", 3),
        ("normalize_pba_distrito_code", 3),
    ],
)
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
    for name in (
        "normalize_distrito_code",
        "normalize_seccion_code",
        "normalize_pba_distrito_code",
        "normalize_circuito_code",
    ):
        assert getattr(admin_codes, name)(raw) == raw


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("1", "00001"),
        ("00001", "00001"),
        (" 1a ", "0001A"),
        ("0001A", "0001A"),
        ("123456", "123456"),
        ("12345b", "12345B"),
        ("000001", "000001"),
    ],
)
def test_circuito_padding_and_suffix(raw, expected):
    assert admin_codes.is_canonicalizable_circuito_code(raw)
    assert admin_codes.normalize_circuito_code(raw) == expected


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("000248", "00248"),
        ("00248", "00248"),
        ("248", "00248"),
        ("00248A", "0248A"),
        ("0248A", "0248A"),
        ("248a", "0248A"),
        ("000001", "00001"),
        ("123456", "123456"),
        ("12345B", "12345B"),
        (" 248a ", "0248A"),
        ("000000", "00000"),
        ("00000a", "0000A"),
    ],
)
def test_circuito_identity_key(raw, expected):
    key = admin_codes.circuito_identity_key(raw)
    assert key == expected
    assert admin_codes.circuito_identity_key(key) == key


@pytest.mark.parametrize(
    "dine_2019,dine_2021",
    [
        ("000248", "00248"),
        ("000249", "00249"),
        ("00248A", "0248A"),
        ("00248B", "0248B"),
        ("00249A", "0249A"),
        ("00249B", "0249B"),
    ],
)
def test_circuito_identity_matches_dine_years_without_changing_normalization(dine_2019, dine_2021):
    assert admin_codes.circuito_identity_key(dine_2019) == admin_codes.circuito_identity_key(
        dine_2021
    )
    assert admin_codes.normalize_circuito_code(dine_2019) == dine_2019
    assert admin_codes.normalize_circuito_code(dine_2021) == dine_2021


@pytest.mark.parametrize("raw", [None, 2, "", " ", "2_7", "-2", "+2", "2.0", "٢", "²", "2AB", "2é"])
def test_circuito_identity_rejects_invalid_codes(raw):
    assert admin_codes.circuito_identity_key(raw) is None


def test_jurisdiction_reexports_identical_callables():
    for name in (
        "normalize_distrito_code",
        "normalize_seccion_code",
        "normalize_pba_distrito_code",
        "normalize_circuito_code",
        "is_canonicalizable_code",
        "is_canonicalizable_circuito_code",
    ):
        assert getattr(jurisdiction, name) is getattr(admin_codes, name)


def test_import_without_site_packages():
    etl_dir = Path(__file__).resolve().parents[1]
    result = subprocess.run(
        [
            sys.executable,
            "-S",
            "-B",
            "-c",
            f"import sys; sys.path.insert(0, {str(etl_dir)!r}); import etl.admin_codes",
        ],
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stdout + result.stderr
