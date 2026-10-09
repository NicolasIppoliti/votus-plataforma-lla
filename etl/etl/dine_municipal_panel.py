"""Stream verified DINE inventories and single-cargo mesa aggregates.

Absent vote types are zero only for present, non-quarantined mesas; no
missing mesa is synthesized. Alias counts cover valid selected rows.
"""
from __future__ import annotations

import argparse
from collections import Counter, defaultdict
import csv
import hashlib
from fractions import Fraction
import io
import json
from pathlib import Path
import sys
import zipfile

if __name__ == "__main__":
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from etl.admin_codes import (
    circuito_identity_key, normalize_circuito_code, normalize_distrito_code, normalize_seccion_code,
)

REQUIRED = {"ano", "distrito_id", "seccion_id", "circuito_id", "mesa_id",
            "mesa_tipo", "mesa_electores", "cargo_nombre", "agrupacion_id",
            "agrupacion_nombre", "votos_tipo", "votos_cantidad"}
MESA_ALIASES = {"NATIVO": "NATIVOS", "NATIVOS": "NATIVOS",
                "EXTRANJERO": "EXTRANJEROS", "EXTRANJEROS": "EXTRANJEROS"}
VOTE_ALIASES = {"POSITIVO": "positivo", "EN BLANCO": "blancos", "BLANCOS": "blancos",
                "NULO": "nulos", "NULOS": "nulos", "IMPUGNADO": "impugnados",
                "IMPUGNADOS": "impugnados", "RECURRIDO": "recurridos",
                "RECURRIDOS": "recurridos", "COMANDO": "comando"}
ROW_REASONS = ("short_row", "unknown_mesa_tipo", "unknown_votos_tipo",
               "non_integer_votes", "non_integer_electores", "positive_without_agrupacion",
               "other_jurisdiction", "other_cargo")
MESA_REASONS = ("conflicting_electores", "duplicate_tally",
                "conflicting_agrupacion_name", "multiple_lists_per_agrupacion")


def column_name(value):
    return value.strip().lower().replace("año", "ano")


def results_rows(args, metadata):
    """Shared hash verification, member selection and strict streaming decode."""
    digest = hashlib.sha256()
    archive_bytes = 0
    with args.archive.open("rb") as source:
        while chunk := source.read(1024 * 1024):
            digest.update(chunk)
            archive_bytes += len(chunk)
    sha256 = digest.hexdigest()
    if sha256 != args.expected_sha256:
        raise ValueError(f"archive sha256 mismatch: expected {args.expected_sha256} got {sha256}")
    wrong_years = Counter()
    with zipfile.ZipFile(args.archive) as archive:
        matches = []
        for member in archive.infolist():
            if not member.filename.lower().endswith(".csv"):
                continue
            # Inspect only the header, not later data, during member selection.
            with archive.open(member) as source:
                first = source.readline().decode("utf-8", errors="strict").removeprefix("\ufeff")
            header = next(csv.reader([first]), [])
            if REQUIRED <= {column_name(name) for name in header}:
                matches.append((member, header))
        if len(matches) != 1:
            names = [member.filename for member, _ in matches]
            raise ValueError(f"expected exactly one results member, found {len(matches)}: {names}")
        member, header = matches[0]
        metadata.update(archive_sha256=sha256, archive_bytes=archive_bytes,
                        member=member.filename, member_bytes=member.file_size, header=header)
        with archive.open(member) as source:
            with io.TextIOWrapper(source, encoding="utf-8", errors="strict", newline="") as text:
                text.readline()
                for raw in csv.DictReader(text, fieldnames=header):
                    row = {column_name(k): v for k, v in raw.items() if k is not None}
                    value = row["ano"]
                    if value is not None and value.strip() != str(args.year):
                        wrong_years[value.strip()] += 1
                    yield None if None in raw or None in row.values() else row
        if wrong_years:
            counts = json.dumps(wrong_years, sort_keys=True, ensure_ascii=False)
            raise ValueError(f"row year mismatch: expected {args.year}, counts {counts}")


def jurisdiction(row):
    return (normalize_distrito_code(row["distrito_id"]),
            normalize_seccion_code(row["seccion_id"]))


def base_result(args):
    return {"schema_version": 1, "source": {}, "year": args.year,
            "distrito": normalize_distrito_code(args.distrito),
            "seccion": normalize_seccion_code(args.seccion)}


def inventory(args):
    result = base_result(args)
    categories, mesas = {}, {}
    total = selected = 0
    for row in results_rows(args, result["source"]):
        total += 1
        if row is None:
            raise ValueError("malformed results row")
        if jurisdiction(row) != (result["distrito"], result["seccion"]):
            continue
        selected += 1
        cargo = row["cargo_nombre"].strip()
        tipo, votos = row["mesa_tipo"].rstrip(), row["votos_tipo"].rstrip()
        if cargo not in categories:
            categories[cargo] = {"rows": 0, "mesa_tipo": Counter(), "votos_tipo": Counter()}
            mesas[cargo] = set()
        category = categories[cargo]
        category["rows"] += 1
        category["mesa_tipo"][tipo] += 1
        category["votos_tipo"][votos] += 1
        mesas[cargo].add((normalize_circuito_code(row["circuito_id"]),
                          row["mesa_id"].strip(), tipo.strip()))
    for cargo, category in categories.items():
        category["distinct_mesas"] = len(mesas[cargo])
    result.update(total_rows=total, selected_rows=selected, categories=categories,
                  excluded_rows_by_reason={"other_jurisdiction": total - selected})
    return result


def empty_votes():
    return dict.fromkeys(VOTE_ALIASES.values(), 0)


def mesas(args):
    # Reason counts are per reason, not per distinct row or mesa: one row or
    # mesa failing several checks increments each matching reason, so the sum
    # of a breakdown can exceed the number of excluded rows or quarantined mesas.
    result = base_result(args)
    excluded = dict.fromkeys(ROW_REASONS, 0)
    counts = dict.fromkeys(MESA_REASONS, 0)
    records, reasons, seen = {}, defaultdict(set), defaultdict(set)
    names, lists, party_mesas = defaultdict(set), defaultdict(set), defaultdict(set)
    aliases = defaultdict(Counter)
    for row in results_rows(args, result["source"]):
        if row is None:
            excluded["short_row"] += 1
            continue
        if jurisdiction(row) != (result["distrito"], result["seccion"]):
            excluded["other_jurisdiction"] += 1
            continue
        row = {k: v.strip() for k, v in row.items()}
        if row["cargo_nombre"] != args.cargo.strip():
            excluded["other_cargo"] += 1
            continue
        tipo = MESA_ALIASES.get(row["mesa_tipo"])
        vote = VOTE_ALIASES.get(row["votos_tipo"])
        party = row["agrupacion_id"]
        failures = []
        if tipo is None:
            failures.append("unknown_mesa_tipo")
        if vote is None:
            failures.append("unknown_votos_tipo")
        for field, reason in (("votos_cantidad", "non_integer_votes"),
                              ("mesa_electores", "non_integer_electores")):
            if not row[field].isascii() or not row[field].isdigit():
                failures.append(reason)
        if vote == "positivo" and not party:
            failures.append("positive_without_agrupacion")
        if failures:
            for reason in failures:
                excluded[reason] += 1
            continue
        aliases[row["mesa_tipo"]][tipo] += 1
        aliases[row["votos_tipo"]][vote] += 1
        key = (normalize_circuito_code(row["circuito_id"]), row["mesa_id"], tipo)
        electores, quantity = int(row["mesa_electores"]), int(row["votos_cantidad"])
        record = records.setdefault(key, dict(circuito=key[0], mesa=key[1], mesa_tipo=tipo,
                                              electores=electores, votes=empty_votes(),
                                              positive={}, source_rows=0))
        record["source_rows"] += 1
        if record["electores"] != electores:
            reasons[key].add("conflicting_electores")
        tally = (vote, party if vote == "positivo" else "")
        if tally in seen[key]:
            reasons[key].add("duplicate_tally")
        seen[key].add(tally)
        record["votes"][vote] += quantity
        if party:
            names[party].add(row["agrupacion_nombre"])
            party_mesas[party].add(key)
            if row.get("lista_numero"):
                lists[party].add(row["lista_numero"])
        if vote == "positivo":
            record["positive"][party] = {"name": row["agrupacion_nombre"], "votes": quantity}
    for party, keys in party_mesas.items():
        for reason, values in (("conflicting_agrupacion_name", names[party]),
                               ("multiple_lists_per_agrupacion", lists[party])):
            if len(values) > 1:
                for key in keys:
                    reasons[key].add(reason)
    accepted, quarantined = [], []
    totals = dict(mesas=0, electores=0, votes=empty_votes(), positive={})
    for key, record in sorted(records.items()):
        if reasons[key]:
            quarantined.append(dict(zip(("circuito", "mesa", "mesa_tipo"), key),
                                    reasons=sorted(reasons[key])))
            for reason in reasons[key]:
                counts[reason] += 1
            continue
        accepted.append(record)
        totals["mesas"] += 1
        totals["electores"] += record["electores"]
        for vote, quantity in record["votes"].items():
            totals["votes"][vote] += quantity
        for party, value in record["positive"].items():
            target = totals["positive"].setdefault(party, {"name": value["name"], "votes": 0})
            target["votes"] += value["votes"]
    result.update(cargo=args.cargo.strip(), label_aliases_used=aliases, mesas=accepted,
                  totals=totals, excluded_rows_by_reason=excluded,
                  quarantined_mesas_by_reason=counts, quarantined_mesas=quarantined)
    return result


def strict_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"duplicate key: {key}")
        result[key] = value
    return result


def validate_inputs(data, root):
    def require(condition, reason):
        if not condition:
            raise ValueError(reason)

    def text(value):
        return isinstance(value, str) and bool(value.strip())

    fields = {"schema_version", "distrito", "seccion", "target_category", "elections"}
    require(isinstance(data, dict) and set(data) == fields, "unexpected or missing top-level fields")
    require(type(data["schema_version"]) is int and data["schema_version"] == 1,
            "schema_version must be 1")
    for key, width in (("distrito", 2), ("seccion", 3)):
        value = data[key]
        require(isinstance(value, str) and len(value) == width
                and value.isascii() and value.isdigit(), f"{key} must be a {width}-digit code")
    require(text(data["target_category"]), "target_category must be non-empty text")
    elections = data["elections"]
    require(isinstance(elections, list) and bool(elections), "elections must be a non-empty list")
    previous = None
    fields = {"year", "archive", "expected_sha256", "cargo", "proxy"}
    for election in elections:
        require(isinstance(election, dict) and fields <= set(election)
                and set(election) <= fields | {"proxy_note"}, "unexpected or missing election fields")
        year = election["year"]
        require(type(year) is int, "year must be an integer")
        require(previous is None or year > previous, "years must be strictly increasing and unique")
        previous = year
        require(text(election["archive"]), "archive must be non-empty text")
        archive = Path(election["archive"])
        require(not archive.is_absolute() and (root / archive).resolve().is_relative_to(root),
                "archive must be relative to the inputs repository root")
        sha = election["expected_sha256"]
        require(isinstance(sha, str) and len(sha) == 64
                and all(c in "0123456789abcdefABCDEF" for c in sha), "expected_sha256 must be hex64")
        require(text(election["cargo"]), "cargo must be non-empty text")
        require(type(election["proxy"]) is bool, "proxy must be a boolean")
        proxy = election["proxy"]
        require((election["cargo"] != data["target_category"]) == proxy,
                "cargo must differ from target_category exactly when proxy is true")
        note = election.get("proxy_note")
        require(text(note) if proxy else note is None,
                "proxy_note must be non-empty for a proxy and absent/null otherwise")


def panel(args):
    try:
        raw = args.inputs.read_bytes()
        data = json.loads(raw.decode("utf-8"), object_pairs_hook=strict_object)
        root = args.inputs.resolve().parent.parent
        validate_inputs(data, root)
    except (ValueError, OSError) as error:
        raise ValueError(f"invalid inputs: {error}") from error
    result = {key: data[key] for key in ("schema_version", "distrito", "seccion", "target_category")}
    result.update(inputs_sha256=hashlib.sha256(raw).hexdigest(), elections=[], summary=[])
    for election in data["elections"]:
        year = election["year"]
        selected = argparse.Namespace(archive=root / election["archive"], year=year,
                                      expected_sha256=election["expected_sha256"].lower(),
                                      distrito=data["distrito"], seccion=data["seccion"],
                                      cargo=election["cargo"])
        try:
            observed = mesas(selected)
        except UnicodeDecodeError as error:
            raise ValueError(f"year {year}: results member is not valid UTF-8 at byte offset {error.start}") from error
        except (ValueError, OSError, zipfile.BadZipFile, csv.Error) as error:
            raise ValueError(f"year {year}: {error}") from error
        proxy = election["proxy"]
        observed.update(is_proxy=proxy, proxy_for=data["target_category"] if proxy else None,
                        proxy_note=election.get("proxy_note"))
        for record in observed["mesas"] + observed["quarantined_mesas"]:
            record.update(is_proxy=proxy, observed_cargo=election["cargo"])
        result["elections"].append(observed)
        totals = observed["totals"]
        result["summary"].append(dict(year=year, mesas=totals["mesas"],
                                      electores=totals["electores"], positivo=totals["votes"]["positivo"],
                                      quarantined_mesas=len(observed["quarantined_mesas"]),
                                      excluded_rows_by_reason=observed["excluded_rows_by_reason"].copy()))
    return result


def validate_offer_map(data):
    def require(condition, reason):
        if not condition:
            raise ValueError(reason)
    require(isinstance(data, dict) and set(data) == {"schema_version", "years"},
            "unexpected or missing top-level fields")
    require(type(data["schema_version"]) is int and data["schema_version"] == 1,
            "schema_version must be 1")
    require(isinstance(data["years"], dict), "years must be an object")
    fields = {"dine_id", "dine_label", "jeba_list_id", "jeba_label", "basis"}
    for year, pairs in data["years"].items():
        require(year in {"2015", "2017", "2019", "2021", "2023"}, f"unknown year: {year}")
        require(isinstance(pairs, list), f"year {year}: pairs must be a list")
        seen_dine, seen_jeba = set(), set()
        for pair in pairs:
            require(isinstance(pair, dict) and set(pair) == fields,
                    f"year {year}: unexpected or missing pair fields")
            require(all(isinstance(v, str) and v.strip() for v in pair.values()),
                    f"year {year}: pair fields must be non-empty text")
            for field, seen in (("dine_id", seen_dine), ("jeba_list_id", seen_jeba)):
                require(pair[field] not in seen, f"year {year}: duplicate {field}: {pair[field]}")
                seen.add(pair[field])


def reconcile(args):
    def load(path):
        return json.loads(path.read_text(encoding="utf-8"), object_pairs_hook=strict_object)
    try:
        mapping = load(args.offer_map)
        validate_offer_map(mapping)
    except (ValueError, OSError) as error:
        raise ValueError(f"invalid offer map: {error}") from error
    provisional = (json.load(sys.stdin, object_pairs_hook=strict_object)
                   if args.panel == "-" else load(Path(args.panel)))
    definitive = load(args.jeba)
    dine = {e["year"]: e for e in provisional["elections"]}
    jeba = {e["year"]: e for e in definitive["elections"]}
    result = {"schema_version": 1, "elections": [], "years_without_counterpart": {
        "panel": sorted(dine.keys() - jeba.keys()), "jeba": sorted(jeba.keys() - dine.keys())}}
    for year in sorted(dine.keys() & jeba.keys()):
        p, j = dine[year], jeba[year]
        totals = p["totals"]
        entry = dict(year=year, is_proxy=p["is_proxy"], proxy_for=p["proxy_for"],
                     jeba_category_unauthenticated=j.get("category_label_as_printed") is None)
        for field in ("mesas", "electores", "positivos", "blancos", "nulos"):
            left = (totals.get(field) if field in ("mesas", "electores") else
                    totals["votes"].get("positivo" if field == "positivos" else field))
            right = j["totals"].get(field)
            entry[field] = dict(dine=left, jeba=right,
                                delta=None if left is None or right is None else left - right)
        positives, offers = totals["positive"], {o["list_id"]: o for o in j["offers"]}
        used_dine, used_jeba, matched = set(), set(), []
        missing = 0
        for pair in mapping["years"].get(str(year), []):
            did, jid = pair["dine_id"], pair["jeba_list_id"]
            if did not in positives or jid not in offers:
                missing += 1
                continue
            used_dine.add(did)
            used_jeba.add(jid)
            left, right = positives[did]["votes"], offers[jid]["votes"]
            delta = None if left is None or right is None else left - right
            denominator = j["totals"].get("positivos")
            share = Fraction(delta, denominator) if delta is not None and denominator else None
            matched.append(dict(dine_id=did, jeba_list_id=jid, dine_votes=left,
                                jeba_votes=right, delta=delta, delta_share_of_jeba_positivos=
                                f"{share.numerator}/{share.denominator}" if share is not None else None))
        unmatched_dine = [dict(dine_id=k, **v) for k, v in sorted(positives.items()) if k not in used_dine]
        unmatched_jeba = [v for k, v in sorted(offers.items()) if k not in used_jeba]
        mesa_delta = entry["mesas"]["delta"]
        entry.update(offers=matched, unmatched_dine=unmatched_dine, unmatched_jeba=unmatched_jeba,
                     mesas_missing_note="unidentified: district totals cannot identify which mesas",
                     reasons=dict(mesas_missing_in_provisional=None if mesa_delta is None else max(-mesa_delta, 0),
                                  mesas_extra_in_provisional=None if mesa_delta is None else max(mesa_delta, 0),
                                  offers_unmatched_dine=len(unmatched_dine), offers_unmatched_jeba=len(unmatched_jeba),
                                  offers_with_vote_delta=sum(o["delta"] not in (None, 0) for o in matched),
                                  map_pair_not_found=missing))
        result["elections"].append(entry)
    result["base_2025"] = (dict(jeba[2025], note="definitive district base; no provisional mesa data")
                           if 2025 in jeba else None)
    return result


def validate_alignment_rules(data, years):
    def require(condition, reason):
        if not condition:
            raise ValueError(reason)
    require(isinstance(data, dict) and set(data) == {
        "schema_version", "pairs", "key", "max_relative_electores_change", "basis"},
        "unexpected or missing fields")
    require(type(data["schema_version"]) is int and data["schema_version"] == 1,
            "schema_version must be 1")
    require(data["key"] == ["circuito_identity_key", "mesa_number", "mesa_tipo"],
            "unsupported key")
    require(isinstance(data["basis"], str) and bool(data["basis"].strip()), "basis must be text")
    pairs = data["pairs"]
    require(isinstance(pairs, list) and bool(pairs), "pairs must be a non-empty list")
    previous = None
    for pair in pairs:
        require(isinstance(pair, list) and len(pair) == 2
                and all(type(y) is int for y in pair), "pairs must contain two integer years")
        require(pair[0] < pair[1] and (previous is None or
                (pair[0] > previous[0] and pair[1] > previous[1])),
                "pairs must be strictly increasing")
        require(all(y in years for y in pair), "pair year absent from panel")
        previous = pair
    raw = data["max_relative_electores_change"]
    require(isinstance(raw, str) and len(raw.split("/")) == 2
            and all(p.isascii() and p.isdigit() for p in raw.split("/")),
            "threshold must be an exact fraction string")
    numerator, denominator = map(int, raw.split("/"))
    require(0 < numerator < denominator, "threshold must be in (0,1)")
    return Fraction(numerator, denominator)


def align(args):
    data = (json.load(sys.stdin, object_pairs_hook=strict_object) if args.panel == "-" else
            json.loads(Path(args.panel).read_text(encoding="utf-8"), object_pairs_hook=strict_object))
    return align_panel(data, args.rules)


def align_panel(data, rules_path, include_records=False):
    """Shared alignment; optional records are internal solver inputs only."""
    elections = {}
    for election in data["elections"]:
        if election["year"] in elections:
            raise ValueError("duplicate panel year")
        elections[election["year"]] = election
    try:
        rules = json.loads(rules_path.read_text(encoding="utf-8"), object_pairs_hook=strict_object)
        threshold = validate_alignment_rules(rules, elections)
    except (ValueError, OSError) as error:
        raise ValueError(f"invalid alignment rules: {error}") from error
    result = dict(schema_version=1, rules=rules, pairs=[])
    for a, b in rules["pairs"]:
        origin, destination = elections[a], elections[b]
        aligned, unaligned = [], []
        counts = dict.fromkeys(("only_in_origin", "only_in_destination",
            "electores_change_exceeds_threshold", "invalid_circuito", "invalid_mesa_number",
            "zero_origin_electores", "quarantined_in_panel"), 0)
        by_tipo = {reason: Counter() for reason in ("only_in_origin", "only_in_destination")}

        def exclude(reason, **records):
            unaligned.append(dict(reason=reason, **records))
            counts[reason] += 1
            if reason in by_tipo:
                by_tipo[reason][next(iter(records.values()))["mesa_tipo"]] += 1

        indexes = []
        for side, election in (("origin", origin), ("destination", destination)):
            index = {}
            for record in election["quarantined_mesas"]:
                exclude("quarantined_in_panel", **{side: record})
            for record in election["mesas"]:
                circuito = circuito_identity_key(record["circuito"])
                number = record["mesa"]
                if circuito is None:
                    exclude("invalid_circuito", **{side: record})
                    continue
                if not isinstance(number, str) or not number.strip().isascii() or not number.strip().isdigit():
                    exclude("invalid_mesa_number", **{side: record})
                    continue
                tipo = MESA_ALIASES.get(record["mesa_tipo"].strip())
                if tipo is None:
                    raise ValueError("invalid panel mesa_tipo")
                key = (circuito, int(number.strip()), tipo)
                if key in index:
                    raise ValueError(f"duplicate alignment key in year {election['year']}: {key}")
                if type(record["electores"]) is not int or record["electores"] < 0:
                    raise ValueError("invalid panel electores")
                index[key] = dict(record, mesa_tipo=tipo)
            indexes.append(index)
        left, right = indexes
        for key in sorted(left.keys() | right.keys()):
            if key not in right:
                exclude("only_in_origin", origin=left[key])
            elif key not in left:
                exclude("only_in_destination", destination=right[key])
            else:
                p, q = left[key], right[key]
                ea, eb = p["electores"], q["electores"]
                if ea == 0:
                    exclude("zero_origin_electores", origin=p, destination=q)
                elif Fraction(abs(eb - ea), ea) > threshold:
                    exclude("electores_change_exceeds_threshold", origin=p, destination=q)
                else:
                    aligned.append(dict(key=list(key), origin_electores=ea, destination_electores=eb,
                                        origin_positivo=p["votes"]["positivo"],
                                        destination_positivo=q["votes"]["positivo"]))
                    if include_records:
                        aligned[-1].update(origin=p, destination=q)
        coverage = dict(aligned_mesas=len(aligned))
        for side, election in (("origin", origin), ("destination", destination)):
            total = len(election["mesas"]) + len(election["quarantined_mesas"])
            assert len(aligned) + sum(side in entry for entry in unaligned) == total
            coverage[f"{side}_mesas"] = total
            denominator = sum(m["votes"]["positivo"] for m in election["mesas"])
            numerator = sum(m[f"{side}_positivo"] for m in aligned)
            share = Fraction(numerator, denominator) if denominator else None
            coverage[f"aligned_{side}_positivo_share"] = (
                f"{share.numerator}/{share.denominator}" if share is not None else None)
        result["pairs"].append(dict(origin_year=a, destination_year=b,
            origin_is_proxy=origin["is_proxy"], destination_is_proxy=destination["is_proxy"],
            aligned=aligned, unaligned=unaligned, counts=counts,
            only_in_by_mesa_tipo=by_tipo, coverage=coverage))
        if include_records:
            result['pairs'][-1]['category_records'] = {
                'origin': origin['mesas'], 'destination': destination['mesas']}
    return result


def transfers(args):
    from etl.mesa_transfers import estimate_transfers, validate_recipe
    try:
        recipe = json.loads(args.recipe.read_text(encoding="utf-8"), object_pairs_hook=strict_object)
        validate_recipe(recipe)
    except (ValueError, OSError) as error:
        raise ValueError(f"invalid recipe: {error}") from error
    data = (json.load(sys.stdin, object_pairs_hook=strict_object) if args.panel == "-" else
            json.loads(Path(args.panel).read_text(encoding="utf-8"), object_pairs_hook=strict_object))
    alignment = align_panel(data, args.rules, include_records=True)
    pair = next((p for p in alignment["pairs"] if
                 [p["origin_year"], p["destination_year"]] == args.pair), None)
    if pair is None:
        raise ValueError("invalid pair: must be a declared alignment pair")
    return estimate_transfers(pair, recipe)


def seats(args):
    from etl.hare_seats import allocate_seats
    if args.seats <= 0:
        raise ValueError("seats must be a positive integer")
    data = json.loads(args.jeba.read_text(encoding="utf-8"), object_pairs_hook=strict_object)
    matches = [e for e in data["elections"] if e["year"] == args.year]
    if len(matches) != 1:
        raise ValueError(f"unknown or duplicate year: {args.year}")
    election = matches[0]
    # The top-level PDF offers include both elector components in 2025.
    votes = {}
    for offer in election["offers"]:
        key = offer["list_id"]
        if key in votes:
            raise ValueError(f"duplicate list_id: {key}")
        votes[key] = offer["votes"]
    return dict(year=args.year, source=election["source"], **allocate_seats(votes, args.seats))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    for name in ("inventory", "mesas"):
        command = commands.add_parser(name, help="Stream a verified DINE ZIP without extraction")
        command.add_argument("--archive", type=Path, required=True)
        command.add_argument("--expected-sha256", required=True)
        command.add_argument("--year", type=int, required=True)
        command.add_argument("--distrito", required=True)
        command.add_argument("--seccion", required=True)
        if name == "mesas":
            command.add_argument("--cargo", required=True)
    command = commands.add_parser("panel", help="Assemble declared multi-year mesa inputs")
    command.add_argument("--inputs", type=Path, required=True)
    command = commands.add_parser("reconcile", help="Compare JSON district totals without archive access")
    command.add_argument("--panel", required=True, help="Panel JSON path or - for stdin")
    command.add_argument("--jeba", type=Path, required=True)
    command.add_argument("--offer-map", type=Path, required=True)
    command = commands.add_parser("align", help="Align mesa identities under declared electores rules")
    command.add_argument("--panel", required=True, help="Panel JSON path or - for stdin")
    command.add_argument("--rules", type=Path, required=True)
    command = commands.add_parser("transfers", help="Estimate a row-stochastic mesa transfer matrix")
    command.add_argument("--panel", required=True, help="Panel JSON path or - for stdin")
    command.add_argument("--rules", type=Path, required=True)
    command.add_argument("--recipe", type=Path, required=True)
    command.add_argument("--pair", type=int, nargs=2, required=True)
    command = commands.add_parser("seats", help="Allocate JEBA PDF list votes under Ley 5109")
    command.add_argument("--jeba", type=Path, required=True)
    command.add_argument("--year", type=int, required=True)
    command.add_argument("--seats", type=int, default=9)
    args = parser.parse_args()
    try:
        result = {"inventory": inventory, "mesas": mesas, "panel": panel,
                  "reconcile": reconcile, "align": align, "transfers": transfers,
                  "seats": seats}[args.command](args)
    except UnicodeDecodeError as error:
        # Offset is decoder-buffer-relative, not necessarily member-relative.
        print(f"error: results member is not valid UTF-8 at byte offset {error.start}", file=sys.stderr)
        return 2
    except (ValueError, OSError, zipfile.BadZipFile, csv.Error) as error:
        print(f"error: {error}", file=sys.stderr)
        return 2
    print(json.dumps(result, sort_keys=True, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
