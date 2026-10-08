"""Calibrate and compose synthetic ideology scenarios; not validated forecasts."""

import argparse
from datetime import date
import json
import math
from fractions import Fraction
import sys


class InputValidationError(ValueError):
    """A controlled public input rejection, not a programming exception."""


def require(condition, message):
    if not condition:
        raise InputValidationError(message)


def nonempty_string(value):
    return isinstance(value, str) and bool(value.strip())


def iso_date(value, label):
    require(isinstance(value, str), f"{label} must be an ISO date")
    try:
        parsed = date.fromisoformat(value)
    except ValueError:
        raise InputValidationError(f"{label} must be an ISO date") from None
    require(parsed.isoformat() == value, f"{label} must be an ISO date")
    return parsed


def json_integer(token):
    # CPython's decimal integer conversion limit raises ValueError in int(),
    # before json.load can construct a payload. Do not catch arbitrary errors.
    try:
        return int(token)
    except ValueError:
        raise InputValidationError("invalid JSON") from None


def validate_profile(profile, label):
    if profile is None:
        return
    require(isinstance(profile, dict), f"{label} profile must be null or an object")
    bands = profile.get("bands")
    require(
        isinstance(bands, list) and bool(bands)
        and all(type(band) is int and -2 <= band <= 2 for band in bands)
        and len(set(bands)) == len(bands),
        f"{label} bands must be a nonempty set of integers in [-2,2]",
    )
    require(nonempty_string(profile.get("basis")), f"{label} basis is required")
    require(nonempty_string(profile.get("citation")), f"{label} citation must be nonempty")
    # Unsupported bases remain well-typed evidence, not usable-axis decisions.
    # Publication and hypothesis dates are independent; neither authenticates
    # historical availability here. Missing/null publication remains UNKNOWN.
    for field in ("available_on", "hypothesis_on"):
        if profile.get(field) is not None:
            iso_date(profile[field], f"{label} {field}")


def validate_profiles(profiles, label):
    require(
        isinstance(profiles, dict) and set(profiles) == {"economic", "social"},
        f"{label} profiles must contain economic and social axes",
    )
    for axis in ("economic", "social"):
        validate_profile(profiles[axis], f"{label} {axis}")


def validate_distribution(election, label):
    denominator = election.get("positive_votes")
    require(
        type(denominator) is int and denominator > 0,
        f"{label} positive_votes must be a positive integer",
    )
    offers = election.get("offers")
    require(isinstance(offers, list), f"{label} offers must be a list")
    ids = set()
    total = 0
    for offer in offers:
        require(isinstance(offer, dict), f"{label} offer must be an object")
        offer_id = offer.get("id")
        require(nonempty_string(offer_id), f"{label} offer id must be nonempty")
        require(offer_id not in ids, f"{label} duplicate offer id {offer_id}")
        ids.add(offer_id)
        votes = offer.get("votes")
        require(
            type(votes) is int and votes >= 0,
            f"{label} offer {offer_id} votes must be a nonnegative integer",
        )
        total += votes
    require(total == denominator, f"{label} positive_votes must equal sum of offer votes")
    return ids


def validate_root(payload):
    require(
        isinstance(payload, dict) and type(payload.get("schema_version")) is int
        and payload["schema_version"] == 1,
        "schema_version must be 1",
    )
    require(payload.get("synthetic") is True,
            "synthetic must be true; real inputs are not frozen")
    for field, expected, message in (
        ("source_kind", "official", "source_kind must be official"),
        ("category", "CONCEJALES", "category must be CONCEJALES"),
        ("election_type", "general", "election_type must be general"),
        ("jurisdiction", "pba:027", "jurisdiction must be normalized pba:027"),
    ):
        require(payload.get(field) == expected, message)
    previous, latest = payload.get("previous"), payload.get("latest")
    require(isinstance(previous, dict) and isinstance(latest, dict),
            "previous and latest observed elections are required")
    for label, election in (("previous", previous), ("latest", latest)):
        require(election.get("observed", True) is True,
                f"{label} must be observed, not a forecast")
    years = (previous.get("year"), latest.get("year"), payload.get("target_year"))
    require(all(type(year) is int for year in years) and years[0] < years[1] < years[2],
            "require previous.year < latest.year < target_year")
    origin = iso_date(payload.get("forecast_origin"), "forecast_origin")
    for label, election in (("previous", previous), ("latest", latest)):
        availability = election.get("available_on")
        require(availability is not None, f"{label} results availability is unknown")
        available = iso_date(availability, f"{label} results availability")
        require(available <= origin, f"{label} results unavailable at forecast_origin")
    validate_distribution(previous, "previous")
    latest_ids = validate_distribution(latest, "latest")
    for label, election in (("previous", previous), ("latest", latest)):
        for offer in election["offers"]:
            validate_profiles(offer.get("profiles"), f"{label} offer {offer['id']}")
    if "target_profiles" in payload:
        targets = payload["target_profiles"]
        require(isinstance(targets, dict) and set(targets) == latest_ids,
                "target_profiles must match latest offer ids exactly")
        for offer_id, profiles in targets.items():
            validate_profiles(profiles, f"target offer {offer_id}")
    require(isinstance(payload.get("calibration_cuts"), list),
            "calibration_cuts must be a list")
    # Cut metadata is screened before applying full guards to eligible inputs.


def classify_profile(profile, origin, *, current_target=False):
    """Classify documented evidence; None marks an unimplemented basis."""
    reasons = []
    if profile is None:
        reasons = ["profile_unknown"]
    elif profile["basis"] == "party_identity":
        reasons = ["party_identity_not_offer_policy"]
    elif profile["basis"] == "member_context":
        reasons = ["member_context_not_offer_policy"]
    elif profile["basis"] != "synthetic_offer_hypothesis":
        return None
    else:
        publication = profile.get("available_on")
        hypothesis = profile.get("hypothesis_on")
        # Current declarations may justify a scenario, never retrospectively
        # authenticate a historical endpoint's publication availability.
        current_declaration = (
            current_target and hypothesis is not None
            and date.fromisoformat(hypothesis) <= origin
        )
        if not current_declaration:
            if publication is None:
                reasons = ["historical_publication_unknown"]
            elif date.fromisoformat(publication) > origin:
                reasons = ["profile_unavailable_at_origin"]
    usable = not reasons
    return {
        "usable": usable,
        "mixed": usable and len(profile["bands"]) > 1,
        "reasons": reasons,
    }


def classify_axes(profiles, origin, *, current_target=False):
    axes = {}
    for axis in ("economic", "social"):
        detail = classify_profile(
            profiles[axis], origin, current_target=current_target,
        )
        if detail is None:
            return None
        axes[axis] = detail
    return axes


def historical_profile_audit(payload, origin):
    """Count every historical offer and vote independently of target masks."""
    details, coverage, breakdown, denominators = {}, {}, {}, {}
    for election in (payload["previous"], payload["latest"]):
        year = str(election["year"])
        denominators[year] = election["positive_votes"]
        details[year] = {}
        for offer in election["offers"]:
            axes = classify_axes(offer["profiles"], origin)
            if axes is None:
                return None
            details[year][offer["id"]] = axes
        coverage[year], breakdown[year] = {}, {}
        for axis in ("economic", "social"):
            counts = {
                f"{group}_{measure}": 0
                for group in ("known", "mixed", "unknown")
                for measure in ("offers", "votes")
            }
            for offer in election["offers"]:
                detail = details[year][offer["id"]][axis]
                if not detail["usable"]:
                    group = "unknown"
                else:
                    group = "mixed" if detail["mixed"] else "known"
                counts[f"{group}_offers"] += 1
                counts[f"{group}_votes"] += offer["votes"]
            breakdown[year][axis] = counts
            coverage[year][axis] = {
                "usable_offers": counts["known_offers"] + counts["mixed_offers"],
                "unknown_offers": counts["unknown_offers"],
                "unknown_votes": counts["unknown_votes"],
            }
    return {
        "positive_vote_denominators": denominators,
        "profile_details": details,
        "profile_coverage": coverage,
        "profile_breakdown": breakdown,
    }


def compatibility_interval(election, axis, q, details):
    """Use every original vote; unavailable evidence spans all five bands."""
    lower = upper = Fraction(0)
    for offer in election["offers"]:
        bands = (
            offer["profiles"][axis]["bands"]
            if details[offer["id"]][axis]["usable"]
            else range(-2, 3)
        )
        kernels = [Fraction(4 - abs(q - r), 4) for r in bands]
        lower += offer["votes"] * min(kernels)
        upper += offer["votes"] * max(kernels)
    denominator = election["positive_votes"]
    return lower / denominator, upper / denominator


def target_axis_audit(payload, history, axis, profile, detail, *, exact_signal=False):
    """Contrast each fixed target hypothesis before taking delta extrema."""
    if not detail["usable"]:
        return {
            "usable": False, "reasons": detail["reasons"],
            "bounds": [], "delta": None, "signal": None,
        }
    bounds, lower_deltas, upper_deltas = [], [], []
    for q in sorted(profile["bands"]):
        intervals = {}
        for label in ("previous", "latest"):
            election = payload[label]
            intervals[label] = compatibility_interval(
                election, axis, q,
                history["profile_details"][str(election["year"])],
            )
        previous, latest = intervals["previous"], intervals["latest"]
        lower_deltas.append(latest[0] - previous[1])
        upper_deltas.append(latest[1] - previous[0])
        bounds.append({
            "q": q,
            "previous": [float(value) for value in previous],
            "latest": [float(value) for value in latest],
        })
    lower, upper = min(lower_deltas), max(upper_deltas)
    signal = lower if lower > 0 else upper if upper < 0 else None
    return {
        "usable": True,
        "reasons": ["trend_unidentified"] if signal is None else [],
        "bounds": bounds,
        "delta": [float(lower), float(upper)],
        "signal": signal if exact_signal else None if signal is None else float(signal),
    }


def rejected_calibration_metadata(payload):
    """Return all rejected rows, or None if any cut needs fuller processing."""
    rejected, ids = [], set()
    parent_origin = date.fromisoformat(payload["forecast_origin"])
    for cut in payload["calibration_cuts"]:
        if not isinstance(cut, dict) or not nonempty_string(cut.get("id")):
            return None
        if cut["id"] in ids or "calibration_cuts" in cut:
            return None
        ids.add(cut["id"])
        records = [cut.get(label) for label in ("previous", "latest", "outcome")]
        if not all(isinstance(record, dict) for record in records):
            return None
        previous, latest, outcome = records
        years = [record.get("year") for record in records] + [cut.get("target_year")]
        if not all(type(year) is int for year in years):
            return None
        if not previous["year"] < latest["year"] < cut["target_year"]:
            return None
        if any(record.get("observed", True) is not True
               or "calibration_cuts" in record for record in (previous, latest)):
            return None
        for field in ("source_kind", "election_type", "category", "jurisdiction"):
            if not nonempty_string(cut.get(field, payload[field])):
                return None
        try:
            origin = iso_date(cut.get("forecast_origin"), "cut forecast_origin")
            publications = [
                None if record.get("available_on") is None
                else iso_date(record["available_on"], "cut results availability")
                for record in records
            ]
        except InputValidationError:
            return None
        if publications[2] is None:
            return None
        reasons = []
        for field, reason in (
            ("source_kind", "source_kind_not_official"),
            ("election_type", "election_type_not_general"),
            ("category", "category_not_comparable"),
            ("jurisdiction", "jurisdiction_not_comparable"),
        ):
            if cut.get(field, payload[field]) != payload[field]:
                reasons.append(reason)
        if any(publication is None for publication in publications[:2]):
            reasons.append("historical_results_availability_unknown")
        if any(publication is not None and publication > origin
               for publication in publications[:2]):
            reasons.append("historical_results_unavailable_at_cut_origin")
        if publications[2] >= parent_origin:
            reasons.append("outcome_not_known_before_origin")
        if outcome["year"] != cut["target_year"]:
            reasons.append("outcome_year_mismatch")
        if outcome.get("observed", True) is not True:
            reasons.append("outcome_not_observed")
        rosters = []
        for record in (latest, outcome):
            if "offers" not in record:
                rosters.append(None)
                continue
            offers = record["offers"]
            if not isinstance(offers, list) or not all(
                isinstance(offer, dict) and nonempty_string(offer.get("id"))
                for offer in offers
            ):
                return None
            roster = [offer["id"] for offer in offers]
            if len(set(roster)) != len(roster):
                return None
            rosters.append(set(roster))
        if all(roster is not None for roster in rosters) and rosters[0] != rosters[1]:
            reasons.append("outcome_roster_not_comparable")
        # Temporal/scope failures do not require omitted distributions. Conversely,
        # no metadata failure means pending, not invented eligibility or fitting.
        if not reasons:
            return None
        rejected.append({"id": cut["id"], "reasons": reasons})
    return rejected


def calibration_fit(payload):
    """Quarantine cuts and score shared serialized predictions on their own inputs."""
    cuts = payload["calibration_cuts"]
    id_counts = {}
    for cut in cuts:
        if isinstance(cut, dict) and nonempty_string(cut.get("id")):
            id_counts[cut["id"]] = id_counts.get(cut["id"], 0) + 1
    rejected, eligible = [], []
    grid = [(e, s) for e in (0, 0.5, 1, 2) for s in (0, 0.5, 1, 2)]
    losses = [Fraction(0) for _ in grid]
    indistinguishable = True
    parent_origin = date.fromisoformat(payload["forecast_origin"])
    inherited = ("schema_version", "synthetic", "source_kind", "election_type",
                 "category", "jurisdiction")
    for index, cut in enumerate(cuts):
        row = {"id": cut["id"]} if (
            isinstance(cut, dict) and nonempty_string(cut.get("id"))
        ) else {"index": index}
        if "id" in row and id_counts[row["id"]] > 1:
            rejected.append({**row, "reasons": ["duplicate_cut_id"]})
            continue
        try:
            require(isinstance(cut, dict), "cut must be an object")
            require(nonempty_string(cut.get("id")), "cut id must be nonempty")
            screened = rejected_calibration_metadata({
                **payload, "calibration_cuts": [cut],
            })
            if screened:
                rejected.extend(screened)
                continue
            origin = iso_date(cut.get("forecast_origin"), "cut forecast_origin")
            if origin >= parent_origin:
                rejected.append({**row, "reasons": ["cut_origin_not_before_origin"]})
                continue
            records = [cut.get(label) for label in ("previous", "latest", "outcome")]
            if any(isinstance(record, dict) and (
                "calibration_cuts" in record or "forecast" in record
            ) for record in [cut, *records]) or any(
                isinstance(record, dict) and record.get("observed", True) is not True
                for record in records[:2]
            ):
                rejected.append({**row, "reasons": ["forecast_as_observation"]})
                continue
            context = {field: payload[field] for field in inherited}
            context.update(cut)
            context["calibration_cuts"] = []
            validate_root(context)
            outcome = cut.get("outcome")
            require(isinstance(outcome, dict), "outcome must be an object")
            require(type(outcome.get("year")) is int,
                    "outcome year must be an integer")
            publication = iso_date(outcome.get("available_on"), "outcome results availability")
            reasons = []
            if publication >= parent_origin:
                reasons.append("outcome_not_known_before_origin")
            if outcome["year"] != context["target_year"]:
                reasons.append("outcome_year_mismatch")
            if outcome.get("observed", True) is not True:
                reasons.append("outcome_not_observed")
            outcome_ids = validate_distribution(outcome, "outcome")
            latest_ids = {offer["id"] for offer in context["latest"]["offers"]}
            if outcome_ids != latest_ids:
                reasons.append("outcome_roster_not_comparable")
            if reasons:
                rejected.append({**row, "reasons": reasons})
                continue
        except InputValidationError as error:
            rejected.append({**row, "reasons": ["invalid_cut_schema"],
                             "schema_error": str(error)})
            continue
        eligible.append(cut["id"])
        state = composition_context(context)
        if state is None:
            return None
        observed = {offer["id"]: Fraction(offer["votes"], outcome["positive_votes"])
                    for offer in outcome["offers"]}
        predictions = [compose(state, pair) for pair in grid]
        indistinguishable = indistinguishable and all(
            prediction == predictions[0] for prediction in predictions[1:]
        )
        for index, prediction in enumerate(predictions):
            losses[index] += sum((abs(share - observed[offer_id])
                                  for offer_id, share in prediction.items()), Fraction(0)) / 2
    scores = [{"beta": list(pair), "mean_tv": float(loss / len(eligible))}
              for pair, loss in zip(grid, losses)] if eligible else []
    beta = None
    if eligible and not indistinguishable:
        selected = min(scores, key=lambda score: (
            score["mean_tv"], sum(score["beta"]), *score["beta"],
        ))
        beta = dict(zip(("economic", "social"), selected["beta"]))
    calibration = {
        "eligible": eligible, "rejected": rejected, "scores": scores,
        "selected_by": "global_mean_tv_then_sum_then_e_then_s",
    }
    if rejected:
        counts, schema_counts = {}, {}
        for row in rejected:
            for reason in row["reasons"]:
                counts[reason] = counts.get(reason, 0) + 1
            if "schema_error" in row:
                error = row["schema_error"]
                schema_counts[error] = schema_counts.get(error, 0) + 1
        calibration["rejection_counts"] = counts
        if schema_counts:
            calibration["schema_error_counts"] = schema_counts
    return calibration, beta


def composition_context(payload):
    """Build exact coefficients and audits once for this root or cut origin."""
    origin = date.fromisoformat(payload["forecast_origin"])
    history = historical_profile_audit(payload, origin)
    if history is None:
        return None
    offers, anchors, coefficients, base = {}, [], {}, {}
    for offer in payload["latest"]["offers"]:
        profiles = payload.get("target_profiles", {}).get(offer["id"], offer["profiles"])
        axes = classify_axes(profiles, origin, current_target=True)
        if axes is None:
            return None
        offer_id = offer["id"]
        base[offer_id] = Fraction(offer["votes"], payload["latest"]["positive_votes"])
        if not any(detail["usable"] for detail in axes.values()):
            anchors.append(offer_id)
        audit = {
            axis: target_axis_audit(payload, history, axis, profiles[axis], detail,
                                    exact_signal=True)
            for axis, detail in axes.items()
        }
        coefficients[offer_id] = tuple(
            audit[axis]["signal"] or Fraction(0) for axis in ("economic", "social")
        )
        for detail in audit.values():
            if detail["signal"] is not None:
                detail["signal"] = float(detail["signal"])
        offers[offer_id] = audit
    return {
        "base": base, "anchors": anchors, "coefficients": coefficients,
        "history": history, "offers": offers,
        "h": Fraction(payload["target_year"] - payload["latest"]["year"],
                      payload["latest"]["year"] - payload["previous"]["year"]),
    }


def compose(state, beta):
    """Preserve anchors and apportion only exact free mass, for cuts and root."""
    base = state["base"]
    free = sorted(set(base) - set(state["anchors"]))
    mass = sum((base[offer_id] for offer_id in free), Fraction(0))
    if len(free) <= 1 or mass == 0:
        return base.copy()
    e, s = map(Fraction, beta)
    exponents = {
        offer_id: state["h"] * (e * state["coefficients"][offer_id][0]
                                 + s * state["coefficients"][offer_id][1])
        for offer_id in free
    }
    # Common factors cancel exactly, even when exp would overflow.
    if len(set(exponents.values())) == 1:
        return base.copy()
    diagnostic = "positive free mass requires a finite positive score sum"
    try:
        scores = {offer_id: float(base[offer_id]) * math.exp(float(exponents[offer_id]))
                  for offer_id in free}
        total = math.fsum(scores.values())
    except OverflowError:
        raise InputValidationError(diagnostic) from None
    require(math.isfinite(total) and total > 0
            and all(math.isfinite(score) and score >= 0 for score in scores.values()),
            diagnostic)
    exact = {offer_id: Fraction(score) for offer_id, score in scores.items()}
    exact_total = sum(exact.values(), Fraction(0))
    require(exact_total > 0, diagnostic)
    quotas = {offer_id: score / exact_total * 10**12
              for offer_id, score in exact.items()}
    units = {offer_id: quota.numerator // quota.denominator
             for offer_id, quota in quotas.items()}
    priority = sorted(free, key=lambda offer_id: (
        -(quotas[offer_id] - units[offer_id]), offer_id,
    ))
    for offer_id in priority[:10**12 - sum(units.values())]:
        units[offer_id] += 1
    return {**base, **{offer_id: mass * Fraction(units[offer_id], 10**12)
                      for offer_id in free}}


def experiment_report(payload):
    """Fit earlier cuts, then compose the root without authenticating real data."""
    fit = calibration_fit(payload)
    if fit is None:
        return None
    calibration, beta = fit
    state = composition_context(payload)
    if state is None:
        return None
    prediction = compose(state, (0, 0) if beta is None
                         else (beta["economic"], beta["social"]))
    def serialized(distribution):
        return {offer_id: {"numerator": share.numerator, "denominator": share.denominator}
                for offer_id, share in distribution.items()}
    shares = serialized(prediction)
    reference = serialized(state["base"])
    anchors = state["anchors"]
    reasons = {}
    if beta is None:
        reasons["insufficient_signal" if calibration["eligible"]
                else "insufficient_calibration"] = 1
    if anchors:
        reasons["profile_neither_axis_usable"] = len(anchors)
    audit = {
        **state["history"],
        "anchored_offers": sorted(anchors),
        "reasons": reasons,
        "offers": state["offers"],
        "calibration": calibration,
        "evaluation": {
            "performed": False,
            "scientific_acceptance": False,
            "reason": "actual_inputs_and_outer_cuts_unfrozen",
        },
    }
    return {
        "synthetic": True,
        "forecast_ready": False,
        "slice10_unblocked": False,
        "status": "reference_only" if shares == reference else "experimental",
        "reference_shares": reference,
        "shares": shares,
        "beta": beta,
        "h": float(state["h"]),
        "grid": [[economic, social]
                 for economic in (0, 0.5, 1, 2)
                 for social in (0, 0.5, 1, 2)],
        "audit": audit,
    }


class ExperimentArgumentParser(argparse.ArgumentParser):
    """Keep public argument diagnostics independent of the script filename."""

    def error(self, message):
        self.print_usage(sys.stderr)
        self.exit(2, f"error: {message}\n")


def main():
    parser = ExperimentArgumentParser(
        prog="pba-ideology-experiment",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        description=(
            "Experimental ideology-conditioned v1; read JSON from stdin. "
            "Not a validated forecast."
        ),
    )
    # Help and argument rejection must finish before stdin is read.
    parser.parse_args()

    try:
        payload = json.load(sys.stdin, parse_int=json_integer)
    except (json.JSONDecodeError, UnicodeDecodeError):
        sys.stderr.write("error: invalid JSON\n")
        return 2
    except InputValidationError as error:
        sys.stderr.write(f"error: {error}\n")
        return 2

    try:
        validate_root(payload)
        report = experiment_report(payload)
    except InputValidationError as error:
        sys.stderr.write(f"error: {error}\n")
        return 2

    if report is not None:
        sys.stdout.write(json.dumps(
            report, sort_keys=True, separators=(",", ":"), allow_nan=False,
        ) + "\n")
        return 0

    sys.stderr.write(
        "error: synthetic pipeline processing is not implemented at this stage\n"
    )
    return 2


if __name__ == "__main__":
    sys.exit(main())
