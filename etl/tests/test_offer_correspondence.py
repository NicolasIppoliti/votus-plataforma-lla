"""Validate sourced core relations independently of informational overlaps."""
import json
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CORE = {"continuation", "merge", "split"}


def test_offer_correspondence_complete_canonical_coverage_and_core_predecessors():
    totals = json.loads((ROOT / "curated/slice-09-jeba-definitive-totals.json").read_text())
    data = json.loads((ROOT / "curated/slice-09-offer-correspondence.json").read_text())
    assert data["schema_version"] == 1
    assert data["relation_rule"]["declared_on"] == "2026-10-09"
    offers = {e["year"]: {o["list_id"] for o in e["offers"]} for e in totals["elections"]}
    years = sorted(offers)
    assert [(p["origin_year"], p["destination_year"]) for p in data["pairs"]] == list(zip(years, years[1:]))
    for pair in data["pairs"]:
        seen = {"origins": set(), "destinations": set()}
        supported = {"origins": set(), "destinations": set()}
        unsupported = {"origins": set(), "destinations": set()}
        predecessors = defaultdict(list)
        for relation in pair["relations"]:
            kind = relation["type"]
            origins, destinations = relation["origins"], relation["destinations"]
            assert kind in CORE | {"exit", "entry"}
            assert len(origins) == len(set(origins)) and len(destinations) == len(set(destinations))
            if kind == "continuation":
                assert len(origins) == len(destinations) == 1
            elif kind == "merge":
                assert len(origins) > 1 and len(destinations) == 1
            elif kind == "split":
                assert len(origins) == 1 and len(destinations) > 1
                assert set(relation["destination_core_parties"]) == set(destinations)
                assert all(relation["destination_core_parties"].values())
            elif kind == "exit":
                assert len(origins) == 1 and not destinations
            else:
                assert not origins and len(destinations) == 1
            for side, year in (("origins", pair["origin_year"]), ("destinations", pair["destination_year"])):
                assert set(relation[side]) <= offers[year]
                seen[side].update(relation[side])
                (supported if kind in CORE else unsupported)[side].update(relation[side])
            if kind in CORE:
                assert relation.get("core_parties") or relation.get("basis") in {"municipal_registry", "brand"}
                assert set(relation["sources"]) == {"origin", "destination"}
                for side, ids in (("origin", origins), ("destination", destinations)):
                    citations = relation["sources"][side]
                    assert set(citations) == set(ids)
                    for refs in citations.values():
                        assert refs
                        for ref in refs:
                            source = data["sources"][ref]
                            assert source["url"].startswith("https://")
                            assert source["kind"] in {"official", "secondary"}
                            assert source["claim"].strip()
                            assert source["evidence_status"] in {"cited_not_refetched", "verified_visually_by_parent_2026-10-09", "verified_text_extraction_by_parent_2026-10-09"}
                for destination in destinations:
                    predecessors[destination].append(relation)
            else:
                assert relation["note"].strip()
        for side, year in (("origins", pair["origin_year"]), ("destinations", pair["destination_year"])):
            assert seen[side] == offers[year]
            assert not supported[side] & unsupported[side]
        for records in predecessors.values():
            if len(records) > 1:
                all_origins = {origin for r in records for origin in r["origins"]}
                assert any(r["type"] == "merge" and set(r["origins"]) >= all_origins for r in records)
        for overlap in pair["member_overlap"]:
            assert overlap["origin"] in offers[pair["origin_year"]]
            assert overlap["destination"] in offers[pair["destination_year"]]
            assert overlap["role"] == "minor" and overlap["shared_parties"]
    for prior in data.get("families", []):
        assert prior["basis"].strip() and prior["declared_on"] == "2026-10-09"
        assert prior["interpretation"] == "modelling_prior_not_measured_ideology"
