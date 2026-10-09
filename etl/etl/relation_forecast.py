"""User-decided model (2026-10-09): forecast by RELATION TYPE.

Training: for each training pair (p→q) the EI point matrix T from the existing transfers estimator
(panel + alignment rules + transfer recipe; bootstrap NOT needed here — call the point estimator
only) and the correspondence relations for (p→q). Classify each origin category: continuing (has
core successor(s) S(o)), exit, or __non_positive__. Destination categories: successor(s), other
continuing destinations, entries (no core predecessor), __non_positive__.
Per origin o: retention R_o = Σ_{s∈S(o)} T[o][s]; leakage L_o = Σ other continuing; entry E_o = Σ
entries; nonpos N_o = T[o][NP]. Exit origins: X_c (to continuing), X_e (to entries), X_n (to NP). NP
origin: A_c, A_e (to continuing / entries), A_n stays.
Pooled rates = weighted mean over all origins of the same class across ALL training pairs, weights =
origin category's total votes in the aligned mesas (declared "origin_votes_weighted_pool"). If a
class has no observations in training (e.g. no entries ever), use declared fallback: that rate is 0
and its mass is reassigned per the next rule (document).
Application to forecast pair (t→t+2) using JEBA definitive t votes per offer + NP_t = electores_t −
positivos_t (if JEBA electores missing → error, never guess): build T̂ row by row: continuing origin
o: R to its successors (equal split if several distinct), L to other continuing destinations
proportional to their mapped-share weights (from forecast_baselines core mapping), E split equally
among entries (if no entries, add E to L), N to NP. Exit origin: X_c proportional to continuing
mapped weights, X_e equally to entries (if none → to continuing), X_n to NP. NP origin: A_c, A_e
likewise, A_n to NP. Each row sums to exactly 1 (exact Fractions after converting pooled float rates
with Fraction.from_float? NO — keep pooled rates as floats, but normalize rows; document precision).
Forecast votes_d = Σ_o v_o T̂[o][d]; forecast shares over positive (exclude NP).
Rolling origin: training pairs must all be strictly before t→t+2 (i.e. q <= t). Validate; error
otherwise.

Approved extension: recipient-less positive mass → __non_positive__;
entirely unobserved application class → row 100% __non_positive__.
Forecast shares are over positive votes, so NP mass is effectively redistributed
proportionally, not assigned to any offer. Both moves have row-mass/vote counters.
Zero positive forecast mass leaves shares undefined (null), with an explicit
counter; no metrics are computed. Declared before any model-vs-outcome measurement.
Precision: estimator's rounded floats are pooled; normalized rows place residual
in their last cell. Decimal-string Fractions normalize positive forecast votes
for the existing exact metrics, never Fraction.from_float.
"""

import json
import math
import sys
from fractions import Fraction
from pathlib import Path

from etl.forecast_baselines import (
    baselines,
    core_mapping,
    election_votes,
    number,
    seat_error,
    total_variation,
)
from etl.mesa_transfers import NON_POSITIVE as NP
from etl.mesa_transfers import estimate_transfers

FIELDS = {
    "continuing": ("R", "L", "E", "N"),
    "exit": ("X_c", "X_e", "X_n"),
    NP: ("A_c", "A_e", "A_n"),
}


def forecast(args):
    from etl.dine_municipal_panel import align_panel, strict_object, validate_offer_map

    def load(path):
        return json.loads(Path(path).read_text(encoding="utf-8"), object_pairs_hook=strict_object)

    offer_map = load(args.offer_map)
    validate_offer_map(offer_map)
    recipe = load(args.forecast_recipe)
    expected = dict(
        schema_version=1,
        model="relation_type_transfer",
        pooling="origin_votes_weighted_pool",
        declared_on="2026-10-09",
        training_rule="all available EI pairs with destination year <= forecast origin year",
        note="declared before any model-vs-outcome measurement",
    )
    if any(recipe.get(k) != v for k, v in expected.items()) or not recipe.get("fallbacks"):
        raise ValueError("unsupported forecast recipe declaration")
    a, b = args.pair
    if b != a + 2 or len(args.train) % 2:
        raise ValueError("invalid forecast/training pair")
    training = sorted(zip(args.train[::2], args.train[1::2]))
    if len(set(training)) != len(training) or any(p >= q or q > a for p, q in training):
        raise ValueError("rolling-origin violation or duplicate training pair")
    correspondence, data = load(args.correspondence), load(args.jeba)

    def mapping(years, votes):
        matches = [
            p for p in correspondence["pairs"] if (p["origin_year"], p["destination_year"]) == years
        ]
        if len(matches) != 1:
            raise ValueError("unknown or duplicate correspondence pair")
        if NP in votes or any(NP in r["destinations"] for r in matches[0]["relations"]):
            raise ValueError("offer collides with non-positive category")
        return core_mapping(
            matches[0], {k: Fraction(v, sum(votes.values())) for k, v in votes.items()}
        )

    origin, positive = election_votes(data, a)
    election = next(e for e in data["elections"] if e["year"] == a)
    electores = election["totals"].get("electores")
    if type(electores) is not int or electores < positive:
        raise ValueError("JEBA electores required and must cover positivos")
    application = mapping((a, b), origin)
    panel = (
        json.load(sys.stdin, object_pairs_hook=strict_object)
        if args.panel == "-"
        else load(args.panel)
    )
    aligned = align_panel(panel, args.rules, include_records=True)
    transfer_recipe = load(args.transfer_recipe)
    transfer_recipe.pop("bootstrap", None)
    pooled = {
        k: dict(rates=dict.fromkeys(fields, 0.0), observations=0, origin_votes=0)
        for k, fields in FIELDS.items()
    }
    diagnostics = []
    for years in training:
        matches = [
            p for p in aligned["pairs"] if (p["origin_year"], p["destination_year"]) == years
        ]
        if len(matches) != 1:
            raise ValueError("training pair absent from alignment rules")
        pair = matches[0]
        estimate = estimate_transfers(pair, transfer_recipe)
        train_votes, _ = election_votes(data, years[0])
        mapped = mapping(years, train_votes)
        destinations = set(mapped["destinations"])
        indexes = [
            {r["dine_id"]: r["jeba_list_id"] for r in offer_map["years"].get(str(y), [])}
            for y in years
        ]

        def translate(key, side):
            if key == NP:
                return key
            if key not in indexes[side]:
                raise ValueError(f"year {years[side]}: unmapped DINE id {key}")
            if indexes[side][key] == NP:
                raise ValueError(f"year {years[side]}: offer id {key} maps to reserved category")
            return indexes[side][key]

        estimate["matrix"] = {
            translate(o, 0): {translate(d, 1): v for d, v in row.items()}
            for o, row in estimate["matrix"].items()
        }
        for side, expected_ids in enumerate((set(train_votes), destinations)):
            actual = (
                set(estimate["matrix"])
                if side == 0
                else set(next(iter(estimate["matrix"].values())))
            )
            for key in sorted(expected_ids - actual):
                raise ValueError(f"year {years[side]}: JEBA id {key} absent from translated matrix")
        reverse = {jeba: dine for dine, jeba in indexes[0].items()}
        if set(estimate["matrix"]) != set(train_votes) | {NP} or any(
            set(row) != destinations | {NP} for row in estimate["matrix"].values()
        ):
            raise ValueError("EI/JEBA/correspondence category mismatch")
        usable = [
            m
            for m in pair["aligned"]
            if all(
                m[s]["electores"] >= m[s]["votes"]["positivo"] for s in ("origin", "destination")
            )
        ]
        entries = set(mapped["entries"])
        continuing = destinations - entries
        for o, row in estimate["matrix"].items():
            successors = set(mapped["mapped_origins"].get(o, {}).get("destinations", []))
            kind = NP if o == NP else "continuing" if successors else "exit"
            groups = (
                [successors, continuing - successors, entries, {NP}]
                if kind == "continuing"
                else [continuing, entries, {NP}]
            )
            weight = sum(
                m["origin"]["electores"] - m["origin"]["votes"]["positivo"]
                if o == NP
                else m["origin"]["positive"].get(reverse[o], {"votes": 0})["votes"]
                for m in usable
            )
            pool = pooled[kind]
            pool["observations"] += 1
            pool["origin_votes"] += weight
            for field, targets in zip(FIELDS[kind], groups):
                pool["rates"][field] += weight * sum(row[d] for d in sorted(targets))
        diagnostics.append(
            {
                k: estimate[k]
                for k in (
                    "origin_year",
                    "destination_year",
                    "mesas_used",
                    "mesas_excluded_by_reason",
                    "alignment_excluded_by_reason",
                    "converged",
                )
            }
        )
    for pool in pooled.values():
        pool["rates"] = {
            k: v / pool["origin_votes"] if pool["origin_votes"] else 0.0
            for k, v in pool["rates"].items()
        }
    origin[NP] = electores - positive
    matrix, fallbacks = (
        {},
        {
            k: dict(rows=0, row_mass=0.0, votes=0.0)
            for k in ("entries_absent", "recipient_less", "unobserved_class")
        },
    )
    entries = application["entries"]
    continuing = [d for d in application["destinations"] if d not in entries]
    for o, votes in origin.items():
        row = dict.fromkeys(application["destinations"] + [NP], 0.0)
        successors = application["mapped_origins"].get(o, {}).get("destinations", [])
        kind = NP if o == NP else "continuing" if successors else "exit"
        pool = pooled[kind]

        def count(reason, mass):
            if mass:
                fallbacks[reason]["rows"] += 1
                fallbacks[reason]["row_mass"] += mass
                fallbacks[reason]["votes"] += mass * votes

        def distribute(mass, targets, weighted=False):
            weights = {
                d: float(application["mapped_shares"][d]) if weighted else 1.0 for d in targets
            }
            total = sum(weights.values())
            if not total:
                row[NP] += mass
                count("recipient_less", mass)
            else:
                for d, weight in weights.items():
                    row[d] += mass * weight / total

        if not pool["origin_votes"]:
            row[NP] = 1.0
            count("unobserved_class", 1.0)
        else:
            rates = list(pool["rates"].values())
            scale = sum(rates)
            rates = [v / scale for v in rates]
            if kind == "continuing":
                retention, leak, entry, nonpos = rates
                distribute(retention, successors)
                targets = [d for d in continuing if d not in successors]
            else:
                leak, entry, nonpos = rates
                targets = continuing
            if not entries:
                count("entries_absent", entry)
                leak += entry
            else:
                distribute(entry, entries)
            distribute(leak, targets, weighted=True)
            row[NP] += nonpos
            scale = sum(row.values())
            row = {d: v / scale for d, v in row.items()}
            row[NP] = 1.0 - sum(v for d, v in row.items() if d != NP)
            if -1e-12 <= row[NP] < 0:  # Declared rounding tolerance; larger negatives still fail.
                positive_sum = sum(v for d, v in row.items() if d != NP)
                row = {d: v / positive_sum for d, v in row.items() if d != NP}
                row[NP] = 0.0
        if any(not math.isfinite(v) or v < 0 for v in row.values()):
            raise ValueError("invalid normalized forecast row")
        matrix[o] = row
    forecast_votes = {
        d: sum(v * matrix[o][d] for o, v in origin.items())
        for d in application["destinations"] + [NP]
    }
    positive_votes = {d: Fraction(str(forecast_votes[d])) for d in application["destinations"]}
    total = sum(positive_votes.values())
    shares = {d: v / total for d, v in positive_votes.items()} if total else None
    result = dict(
        schema_version=1,
        origin_year=a,
        destination_year=b,
        recipe=recipe,
        pooled_rates=pooled,
        training=diagnostics,
        matrix=matrix,
        fallbacks=fallbacks,
        forecast_votes=forecast_votes,
        zero_positive_forecast=int(not total),
        jeba_category_unauthenticated=True,
        shares={d: dict(**number(v), votes=forecast_votes[d]) for d, v in shares.items()}
        if shares
        else None,
    )
    if any(e["year"] == b for e in data["elections"]):
        observed, observed_total = election_votes(data, b)
        if set(observed) != set(application["destinations"]):
            raise ValueError("observed destination coverage mismatch")
        result["baselines"] = baselines(args)
        if shares:
            result["TV"] = number(
                total_variation(
                    shares, {d: Fraction(v, observed_total) for d, v in observed.items()}
                )
            )
            result.update(seat_error(shares, observed_total, observed))
    return result
