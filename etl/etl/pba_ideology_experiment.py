"""Validate synthetic stdin inputs; pipeline processing is not implemented."""

import argparse
from datetime import date
import json
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
    # Cut shape/eligibility is not implemented. Do not apply root semantic
    # guards to cuts: later stages must quarantine them with audited reasons.


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


def masked_reference_report(payload):
    """Return a complete reference only where no numerical pipeline is needed."""
    if payload["calibration_cuts"]:
        return None
    origin = date.fromisoformat(payload["forecast_origin"])
    latest = payload["latest"]
    target_profiles = payload.get("target_profiles")
    offers = {}
    for offer in latest["offers"]:
        profiles = (
            offer["profiles"] if target_profiles is None
            else target_profiles[offer["id"]]
        )
        axes = classify_axes(profiles, origin, current_target=True)
        if axes is None or any(detail["usable"] for detail in axes.values()):
            return None
        offers[offer["id"]] = {
            axis: {
                "usable": False,
                "reasons": detail["reasons"],
                "bounds": [],
                "delta": None,
                "signal": None,
            }
            for axis, detail in axes.items()
        }
    history = historical_profile_audit(payload, origin)
    if history is None:
        return None
    shares = {}
    for offer in latest["offers"]:
        share = Fraction(offer["votes"], latest["positive_votes"])
        shares[offer["id"]] = {
            "numerator": share.numerator,
            "denominator": share.denominator,
        }
    audit = {
        **history,
        "anchored_offers": sorted(shares),
        "reasons": {
            "insufficient_calibration": 1,
            "profile_neither_axis_usable": len(shares),
        },
        "offers": offers,
        "calibration": {
            "eligible": [], "rejected": [], "scores": [],
            "selected_by": "global_mean_tv_then_sum_then_e_then_s",
        },
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
        "status": "reference_only",
        "reference_shares": shares,
        "shares": shares,
        "beta": None,
        "h": (payload["target_year"] - latest["year"])
             / (latest["year"] - payload["previous"]["year"]),
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
    except InputValidationError as error:
        sys.stderr.write(f"error: {error}\n")
        return 2

    report = masked_reference_report(payload)
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
