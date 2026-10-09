"""Historical DINE registrations through the production source lookup."""

import pytest

from etl.__main__ import find_source_entry, load_sources


@pytest.mark.parametrize(
    "year, expected_sha256",
    [
        (2015, "870e0ea7826e81847caa2e1e9d203955577b748721edd89f74e93ecfb9715e12"),
        (2017, "7c89e3905dc1b079b85ec1eb0cb8fc851acdc8b151024036137450bb672cd97b"),
        (2019, "eb62f4e999a75754db1d3f446a5977679a0d34faba81de6afc13cb20943e4bf7"),
        (2021, "0b44fc815876cefdfc3341fccef5d38f51e225aa043eca36df19f7e33cbac992"),
    ],
)
def test_historical_dine_generales_registration(year, expected_sha256):
    entry = find_source_entry(load_sources(), f"national/{year}-generales")
    assert entry is not None
    assert entry["capability"] == "national"
    assert entry["source_url"] == (
        f"https://www.argentina.gob.ar/sites/default/files/{year}-provisorios_generales.zip"
    )
    assert entry["election_year"] == year
    assert entry["election_round"] == "generales"
    assert entry["source"] == "argentina.gob.ar"
    assert entry["mime"] == "application/zip"
    assert entry["filename"] == f"{year}-generales.zip"
    assert "provisional scrutiny, mesa level" in entry["notes"]
    assert entry.get("expected_sha256") == expected_sha256
