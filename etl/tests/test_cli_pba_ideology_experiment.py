"""Synthetic public-entry tests; not electoral evidence or candidate evaluation.

Run only under a fresh, explicit native scope. The standalone unittest runner
uses stdlib; normal pytest discovery remains supported and unchanged.
"""

import json
import os
import selectors
import subprocess
import sys
import time
import unittest
from pathlib import Path

class StopOnUnexpectedResult(unittest.TextTestResult):
    def addError(self, test, err):
        super().addError(test, err)
        self.stop()

    def addFailure(self, test, err):
        super().addFailure(test, err)
        if not (EXPECT_MISSING_ENTRY_RED and err[0] is test.failureException
                and getattr(test, "_expected_contract_red", False)):
            self.stop()


EXPECT_MISSING_ENTRY_RED = False
SERIALIZATION_SELECTORS = (
    "TestRemainingIdeologyPublicEntry.test_serialization_largest_remainder_id_tie",
    "TestRemainingIdeologyPublicEntry.test_serialization_id_priority_is_input_order_independent",
)
STAGE1_DIAGNOSTIC_SELECTORS = (
    "TestRemainingIdeologyPublicEntry.test_invalid_json",
    "TestRemainingIdeologyPublicEntry.test_schema_rejection",
    "TestRemainingIdeologyPublicEntry.test_real_input_unfrozen",
    "TestRemainingIdeologyPublicEntry.test_mixed_source",
)
MODULE = Path(__file__).parents[1] / "etl" / "pba_ideology_experiment.py"
REFERENCE_INPUT = (
    '{"schema_version":1,"synthetic":true,"source_kind":"official","jurisdiction":"pba:027","'
    'category":"CONCEJALES","election_type":"general","forecast_origin":"2026-01-01","target_'
    'year":2027,"previous":{"year":2023,"available_on":"2023-12-06","positive_votes":10,"offe'
    'rs":[{"id":"old-a","votes":4,"profiles":{"economic":null,"social":null}},{"id":"old-b","'
    'votes":6,"profiles":{"economic":null,"social":null}}]},"latest":{"year":2025,"available_'
    'on":"2025-12-08","positive_votes":10,"offers":[{"id":"latest-a","votes":3,"profiles":{"e'
    'conomic":null,"social":null}},{"id":"latest-b","votes":7,"profiles":{"economic":null,"so'
    'cial":null}}]},"calibration_cuts":[]}'
)
HELP = (
    "usage: pba-ideology-experiment [-h]\n\n"
    "Experimental ideology-conditioned v1; read JSON from stdin. "
    "Not a validated forecast.\n\n"
    "options:\n"
    "  -h, --help  show this help message and exit\n"
)


class TestIdeologyPublicEntry(unittest.TestCase):
    def invoke(self, stdin: str = "", *args: str) -> subprocess.CompletedProcess[str]:
        argv = [sys.executable, "-I", "-S", "-B", str(MODULE), *args]
        pending = memoryview(stdin.encode("utf-8"))
        captured = {"stdout": bytearray(), "stderr": bytearray()}
        deadline = time.monotonic() + 5
        child = subprocess.Popen(
            argv, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            bufsize=0, cwd=MODULE.parent, env={"LC_ALL": "C", "PATH": ""},
        )
        streams = (child.stdin, child.stdout, child.stderr)
        sent = 0
        try:
            with selectors.DefaultSelector() as ready:
                for stream, label in zip(streams, ("stdin", "stdout", "stderr")):
                    os.set_blocking(stream.fileno(), False)
                    if label == "stdin" and not pending:
                        stream.close()
                    else:
                        event = selectors.EVENT_WRITE if label == "stdin" else selectors.EVENT_READ
                        ready.register(stream, event, label)
                while ready.get_map():
                    remaining = deadline - time.monotonic()
                    if remaining <= 0:
                        raise TimeoutError("CLI child exceeded five-second deadline")
                    for key, _ in ready.select(remaining):
                        if time.monotonic() >= deadline:
                            raise TimeoutError("CLI child exceeded five-second deadline")
                        stream, label = key.fileobj, key.data
                        if label == "stdin":
                            try:
                                sent += os.write(stream.fileno(), pending[sent:sent + 4096])
                            except BlockingIOError:
                                continue
                            except BrokenPipeError:
                                # Early rejection/absent entry may close stdin without reading it.
                                ready.unregister(stream)
                                stream.close()
                                continue
                            if sent == len(pending):
                                ready.unregister(stream)
                                stream.close()
                        else:
                            buffer = captured[label]
                            # Read at most the remaining allowance plus ONE detection byte.
                            try:
                                data = os.read(stream.fileno(), min(4096, 32768 - len(buffer) + 1))
                            except BlockingIOError:
                                continue
                            if not data:
                                ready.unregister(stream)
                                stream.close()
                            elif len(buffer) + len(data) > 32768:
                                raise RuntimeError(f"CLI child {label} exceeded 32768-byte cap")
                            else:
                                buffer.extend(data)
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise TimeoutError("CLI child exceeded five-second deadline")
                rc = child.wait(timeout=remaining)
            return subprocess.CompletedProcess(
                argv, rc, captured["stdout"].decode("utf-8"), captured["stderr"].decode("utf-8"),
            )
        finally:
            # Only this direct child is owned; no process-group/host isolation claim.
            try:
                if child.poll() is None:
                    child.kill()
                child.wait(timeout=1)
            finally:
                for stream in streams:
                    stream.close()

    def test_help_reaches_the_experimental_entry(self):
        result = self.invoke("", "--help")
        self.assertEqual(result.returncode, 0)
        self.assertEqual(result.stdout, HELP)
        self.assertEqual(result.stderr, "")

    def test_neither_axis_usable_preserves_exact_latest_shares(self):
        result = self.invoke(REFERENCE_INPUT + "\n")
        self.assertEqual(result.returncode, 0)
        self.assertEqual(result.stderr, "")
        report = json.loads(result.stdout)
        self.assertEqual(
            result.stdout,
            json.dumps(report, sort_keys=True, separators=(",", ":"), allow_nan=False) + "\n",
        )
        exact_shares = {
            "latest-a": {"numerator": 3, "denominator": 10},
            "latest-b": {"numerator": 7, "denominator": 10},
        }
        self.assertEqual(report["reference_shares"], exact_shares)
        self.assertEqual(report["shares"], exact_shares)
        self.assertEqual(report["status"], "reference_only")
        self.assertIs(report["synthetic"], True)
        self.assertIs(report["forecast_ready"], False)
        self.assertIs(report["slice10_unblocked"], False)
        self.assertIsNone(report["beta"])
        self.assertEqual(report["audit"]["anchored_offers"], ["latest-a", "latest-b"])
        self.assertEqual(
            report["audit"]["reasons"],
            {
                "insufficient_calibration": 1,
                "profile_neither_axis_usable": 2,
            },
        )
        self.assertEqual(
            report["audit"]["positive_vote_denominators"], {"2023": 10, "2025": 10}
        )
        self.assertEqual(report["audit"]["profile_coverage"], {
            "2023": {
                "economic": {"usable_offers": 0, "unknown_offers": 2, "unknown_votes": 10},
                "social": {"usable_offers": 0, "unknown_offers": 2, "unknown_votes": 10},
            },
            "2025": {
                "economic": {"usable_offers": 0, "unknown_offers": 2, "unknown_votes": 10},
                "social": {"usable_offers": 0, "unknown_offers": 2, "unknown_votes": 10},
            },
        })

    def test_fiscalizacion_is_rejected_before_any_result(self):
        payload = REFERENCE_INPUT.replace(
            '"source_kind":"official"', '"source_kind":"fiscalizacion"'
        )
        result = self.invoke(payload + "\n")
        self.assertEqual(result.returncode, 2)
        self.assertEqual(result.stdout, "")
        self.assertEqual(result.stderr, "error: source_kind must be official\n")


# The fixture is test-owned synthetic data, not an archive or private fixture.
# Reading it is part of the test runner scope, never part of the CLI.
PLAN = Path(__file__).parent / "fixtures" / "ideology_v1_public_cases.json"


def assert_subset(test, actual, expected, path="report"):
    """Check declared public fields without hiding missing fields or list order."""
    if isinstance(expected, dict):
        test.assertIsInstance(actual, dict, path)
        for key, value in expected.items():
            test.assertIn(key, actual, path)
            assert_subset(test, actual[key], value, f"{path}.{key}")
    else:
        test.assertEqual(actual, expected, path)


class TestRemainingIdeologyPublicEntry(TestIdeologyPublicEntry):
    # Avoid inheriting/rerunning the already consumed first three selectors.
    test_help_reaches_the_experimental_entry = None
    test_neither_axis_usable_preserves_exact_latest_shares = None
    test_fiscalizacion_is_rejected_before_any_result = None

    def check_case(self, case):
        result = self.invoke(case["stdin"], *case.get("args", []))
        self._expected_contract_red = False
        try:
            # Execute the ordinary contract assertions, retaining their traceback.
            self.assertEqual(result.returncode, case["exit"])
            self.assertEqual(result.stderr, case.get("stderr", ""))
        except self.failureException:
            diagnostic = f"{sys.executable}: can't open file '{MODULE}': [Errno 2] No such file or directory\n"
            self._expected_contract_red = (
                EXPECT_MISSING_ENTRY_RED and result.returncode == 2
                and result.stdout == "" and result.stderr == diagnostic
            )
            raise  # Never manufacture or substitute an assertion failure.
        if case["exit"]:
            self.assertEqual(result.stdout, "")
            return
        report = json.loads(result.stdout)
        self.assertEqual(
            result.stdout,
            json.dumps(report, sort_keys=True, separators=(",", ":"), allow_nan=False) + "\n",
        )
        assert_subset(self, report, case["expect"])
        for field in ("status", "reference_shares", "shares", "beta", "h", "grid", "audit"):
            self.assertIn(field, report)
        for field in ("anchored_offers", "reasons", "positive_vote_denominators",
                      "profile_coverage", "profile_details", "profile_breakdown", "offers", "calibration", "evaluation"):
            self.assertIn(field, report["audit"])
        assert_subset(self, report["audit"]["evaluation"], {
            "performed": False, "scientific_acceptance": False,
            "reason": "actual_inputs_and_outer_cuts_unfrozen",
        })
        payload = json.loads(case["stdin"])
        for election in (payload["previous"], payload["latest"]):
            year = str(election["year"])
            self.assertEqual(report["audit"]["positive_vote_denominators"][year], election["positive_votes"])
            details = report["audit"]["profile_details"][year]
            self.assertEqual(set(details), {offer["id"] for offer in election["offers"]})
            for offer in election["offers"]:
                self.assertEqual(set(details[offer["id"]]), {"economic", "social"})
                for axis in ("economic", "social"):
                    detail = details[offer["id"]][axis]
                    for field in ("usable", "mixed", "reasons"):
                        self.assertIn(field, detail)
                    self.assertIs(type(detail["usable"]), bool)
                    self.assertIs(type(detail["mixed"]), bool)
                    self.assertIsInstance(detail["reasons"], list)
            for axis in ("economic", "social"):
                unknown = [offer for offer in election["offers"]
                           if not details[offer["id"]][axis]["usable"]]
                coverage = report["audit"]["profile_coverage"][year][axis]
                self.assertEqual(coverage["unknown_offers"], len(unknown))
                self.assertEqual(coverage["unknown_votes"], sum(offer["votes"] for offer in unknown))
                self.assertEqual(coverage["usable_offers"], len(election["offers"]) - len(unknown))
                breakdown = report["audit"]["profile_breakdown"][year][axis]
                for label in ("known", "mixed", "unknown"):
                    def group(offer):
                        detail = details[offer["id"]][axis]
                        return "unknown" if not detail["usable"] else "mixed" if detail["mixed"] else "known"
                    members = [offer for offer in election["offers"] if group(offer) == label]
                    self.assertEqual(breakdown[f"{label}_offers"], len(members))
                    self.assertEqual(breakdown[f"{label}_votes"], sum(offer["votes"] for offer in members))
        self.assertEqual(set(report["audit"]["offers"]), {offer["id"] for offer in payload["latest"]["offers"]})
        for axes in report["audit"]["offers"].values():
            self.assertEqual(set(axes), {"economic", "social"})
            for detail in axes.values():
                for field in ("usable", "reasons", "bounds", "delta", "signal"):
                    self.assertIn(field, detail)
        self.assertEqual(report["grid"], CORE_GRID)
        calibration = report["audit"]["calibration"]
        for field in ("eligible", "rejected", "scores", "selected_by"):
            self.assertIn(field, calibration)
        self.assertIs(report["audit"]["evaluation"]["performed"], False)
        self.assertIs(report["audit"]["evaluation"]["scientific_acceptance"], False)
        if case.get("require_selected_beta"):
            self.assertIsNotNone(report["beta"])
        if report["beta"] is not None:
            self.assertEqual(set(report["beta"]), {"economic", "social"})
        if calibration["eligible"]:
            self.assertEqual([score["beta"] for score in calibration["scores"]], CORE_GRID)
            for score in calibration["scores"]:
                self.assertIn(type(score["mean_tv"]), (int, float))
                self.assertGreaterEqual(score["mean_tv"], 0)
                self.assertLessEqual(score["mean_tv"], 1)
            if report["beta"] is not None:
                selected = min(calibration["scores"], key=lambda score: (
                    score["mean_tv"], sum(score["beta"]), *score["beta"],
                ))
                self.assertEqual(selected["beta"], [report["beta"]["economic"], report["beta"]["social"]])
                # Tie evidence uses EXACT reported values, never expected-loss tolerance.
                tied = [score for score in calibration["scores"]
                        if score["mean_tv"] == selected["mean_tv"]]
                self.assertEqual(selected["beta"], min(
                    (score["beta"] for score in tied),
                    key=lambda beta: (sum(beta), *beta),
                ))
        else:
            self.assertEqual(calibration["scores"], [])
        self.assertIs(report["synthetic"], True)
        self.assertIs(report["forecast_ready"], False)
        self.assertIs(report["slice10_unblocked"], False)
        self.assertEqual(set(report["shares"]), set(report["reference_shares"]))
        from fractions import Fraction
        import math

        total = Fraction(0)
        reference_total = Fraction(0)
        anchored = report["audit"]["anchored_offers"]
        free_mass = 1 - sum((Fraction(
            report["reference_shares"][offer]["numerator"],
            report["reference_shares"][offer]["denominator"],
        ) for offer in anchored), Fraction(0))
        for offer, share in report["shares"].items():
            self.assertEqual(set(share), {"numerator", "denominator"})
            self.assertIs(type(share["numerator"]), int)
            self.assertIs(type(share["denominator"]), int)
            self.assertGreater(share["denominator"], 0)
            self.assertEqual(math.gcd(share["numerator"], share["denominator"]), 1)
            reference = report["reference_shares"][offer]
            self.assertEqual(set(reference), {"numerator", "denominator"})
            self.assertIs(type(reference["numerator"]), int)
            self.assertIs(type(reference["denominator"]), int)
            self.assertGreater(reference["denominator"], 0)
            self.assertGreaterEqual(reference["numerator"], 0)
            self.assertEqual(math.gcd(reference["numerator"], reference["denominator"]), 1)
            reference_total += Fraction(reference["numerator"], reference["denominator"])
            value = Fraction(share["numerator"], share["denominator"])
            if report["status"] == "experimental" and offer not in anchored and free_mass:
                self.assertEqual((value / free_mass * 10**12).denominator, 1)
            self.assertGreaterEqual(value, 0)
            total += value
            if offer in report["audit"]["anchored_offers"]:
                self.assertEqual(share, report["reference_shares"][offer])
        self.assertEqual(total, 1)
        self.assertEqual(reference_total, 1)
        if "allocation_units" in case:
            self.assertEqual(free_mass, Fraction(4, 5))
            self.assertEqual(set(case["allocation_units"]), set(report["shares"]) - set(anchored))
            self.assertEqual(sum(case["allocation_units"].values()), 10**12)
            for offer, units in case["allocation_units"].items():
                share = report["shares"][offer]
                value = Fraction(share["numerator"], share["denominator"])
                self.assertEqual(value / free_mass * 10**12, units)
        for offer, interval in case.get("share_intervals", {}).items():
            share = report["shares"][offer]
            value = share["numerator"] / share["denominator"]
            self.assertGreaterEqual(value, interval[0])
            self.assertLessEqual(value, interval[1])
        if "constant_calibration_loss" in case:
            for score in calibration["scores"]:
                self.assertEqual(score["mean_tv"], case["constant_calibration_loss"])
        model = case.get("calibration_model")
        if model:
            for score in calibration["scores"]:
                e, s = score["beta"]
                predicted = 1 / (1 + math.exp(-(e * model["e"] + s * model["s"])))
                expected_loss = sum(abs(predicted - value) for value in model["outcomes"]) / len(model["outcomes"])
                self.assertTrue(math.isclose(score["mean_tv"], expected_loss, rel_tol=0, abs_tol=1e-9))
        for comparison in case.get("composition_checks", []):
            offer = comparison["offer"]
            share = report["shares"][offer]
            self.assertTrue(math.isclose(
                share["numerator"] / share["denominator"], comparison["value"],
                rel_tol=0, abs_tol=1e-9,
            ))
        return report


# One process per declared case, no bootstrap, retry, subprocess helper or
# implementation import. Native approval must cover this explicit plan read.
with PLAN.open(encoding="utf-8") as plan_file:
    CORE_PLAN = json.load(plan_file)
    CORE_CASES = CORE_PLAN["cases"]
    CORE_GRID = CORE_PLAN["grid"]


class TestIdeologySchemaPublicEntry(unittest.TestCase):
    # Reuse the bounded public-entry invocation without inheriting baseline tests.
    invoke = TestIdeologyPublicEntry.invoke

    def setUp(self):
        case = next(case for case in CORE_CASES
                    if case["test"] == "test_unsupported_axes_not_centred")
        self.payload = json.loads(case["stdin"])

    def test_large_json_integer_is_parse_rejection(self):
        # Valid JSON syntax; CPython's integer conversion limit rejects the token.
        stdin = '{"schema_version":' + "1" * 5000 + '}\n'
        self.assertLess(len(stdin.encode("utf-8")), 32768)
        result = self.invoke(stdin)
        self.assertEqual(result.returncode, 2)
        self.assertEqual(result.stdout, "")
        self.assertEqual(result.stderr, "error: invalid JSON\n")

    def test_boolean_previous_year_is_rejected(self):
        self.payload["previous"]["year"] = True
        result = self.invoke(json.dumps(self.payload) + "\n")
        self.assertEqual(result.returncode, 2)
        self.assertEqual(result.stdout, "")
        self.assertEqual(result.stderr, "error: require previous.year < latest.year < target_year\n")

    def test_boolean_positive_denominator_is_rejected(self):
        self.payload["previous"]["positive_votes"] = True
        result = self.invoke(json.dumps(self.payload) + "\n")
        self.assertEqual(result.returncode, 2)
        self.assertEqual(result.stdout, "")
        self.assertEqual(result.stderr, "error: previous positive_votes must be a positive integer\n")

    def test_invalid_forecast_origin_is_rejected(self):
        self.payload["forecast_origin"] = "2026-13-01"
        result = self.invoke(json.dumps(self.payload) + "\n")
        self.assertEqual(result.returncode, 2)
        self.assertEqual(result.stdout, "")
        self.assertEqual(result.stderr, "error: forecast_origin must be an ISO date\n")

    def test_invalid_previous_availability_is_rejected(self):
        self.payload["previous"]["available_on"] = "2023-13-01"
        result = self.invoke(json.dumps(self.payload) + "\n")
        self.assertEqual(result.returncode, 2)
        self.assertEqual(result.stdout, "")
        self.assertEqual(result.stderr, "error: previous results availability must be an ISO date\n")

    def test_invalid_latest_availability_is_rejected(self):
        self.payload["latest"]["available_on"] = "2025-13-01"
        result = self.invoke(json.dumps(self.payload) + "\n")
        self.assertEqual(result.returncode, 2)
        self.assertEqual(result.stdout, "")
        self.assertEqual(result.stderr, "error: latest results availability must be an ISO date\n")

    def test_invalid_profile_availability_is_rejected(self):
        case = next(case for case in CORE_CASES
                    if case["test"] == "test_profile_citation_required")
        payload = json.loads(case["stdin"])
        profile = payload["previous"]["offers"][0]["profiles"]["economic"]
        profile["citation"] = "INVENTED"
        profile["available_on"] = "2023-13-01"
        result = self.invoke(json.dumps(payload) + "\n")
        self.assertEqual(result.returncode, 2)
        self.assertEqual(result.stdout, "")
        self.assertEqual(
            result.stderr,
            "error: previous offer a economic available_on must be an ISO date\n",
        )

    def test_invalid_hypothesis_date_is_rejected(self):
        case = next(case for case in CORE_CASES
                    if case["test"] == "test_profile_citation_required")
        payload = json.loads(case["stdin"])
        profile = payload["previous"]["offers"][0]["profiles"]["economic"]
        profile["citation"] = "INVENTED"
        profile["hypothesis_on"] = "2023-13-01"
        result = self.invoke(json.dumps(payload) + "\n")
        self.assertEqual(result.returncode, 2)
        self.assertEqual(result.stdout, "")
        self.assertEqual(
            result.stderr,
            "error: previous offer a economic hypothesis_on must be an ISO date\n",
        )


class TestIdeologyMaskedReferencePublicEntry(unittest.TestCase):
    # Method aliases reuse the public contract without inheriting fixture tests.
    invoke = TestIdeologyPublicEntry.invoke
    check_case = TestRemainingIdeologyPublicEntry.check_case

    def fixture_payload(self, name="test_unsupported_axes_not_centred"):
        case = next(case for case in CORE_CASES if case["test"] == name)
        return json.loads(case["stdin"])

    def check_reference(self, payload, expect=None):
        from fractions import Fraction

        report = self.check_case({
            "stdin": json.dumps(payload) + "\n", "exit": 0,
            "expect": expect or {},
        })
        reference = {}
        for offer in payload["latest"]["offers"]:
            share = Fraction(offer["votes"], payload["latest"]["positive_votes"])
            reference[offer["id"]] = {
                "numerator": share.numerator, "denominator": share.denominator,
            }
        self.assertEqual(report["reference_shares"], reference)
        self.assertEqual(report["shares"], reference)
        self.assertEqual(report["status"], "reference_only")
        self.assertIsNone(report["beta"])
        self.assertEqual(report["audit"]["anchored_offers"], sorted(reference))
        self.assertEqual(report["audit"]["calibration"], {
            "eligible": [], "rejected": [], "scores": [],
            "selected_by": "global_mean_tv_then_sum_then_e_then_s",
        })
        for axes in report["audit"]["offers"].values():
            for detail in axes.values():
                self.assertIs(detail["usable"], False)
                self.assertEqual(detail["bounds"], [])
                self.assertIsNone(detail["delta"])
                self.assertIsNone(detail["signal"])
        return report

    def test_all_null_axes_emit_masked_reference_envelope(self):
        payload = self.fixture_payload()
        for election in (payload["previous"], payload["latest"]):
            for offer in election["offers"]:
                offer["profiles"] = {"economic": None, "social": None}
        payload.pop("target_profiles", None)
        report = self.check_reference(payload)
        self.assertEqual(report["audit"]["reasons"], {
            "insufficient_calibration": 1,
            "profile_neither_axis_usable": len(payload["latest"]["offers"]),
        })
        for axes in report["audit"]["offers"].values():
            for detail in axes.values():
                self.assertEqual(detail["reasons"], ["profile_unknown"])

    def test_unsupported_policy_axes_emit_no_numeric_masks(self):
        case = next(case for case in CORE_CASES
                    if case["test"] == "test_unsupported_axes_not_centred")
        report = self.check_reference(json.loads(case["stdin"]), case["expect"])
        axes = report["audit"]["offers"]["b"]
        self.assertEqual(axes["economic"]["reasons"], ["party_identity_not_offer_policy"])
        self.assertEqual(axes["social"]["reasons"], ["member_context_not_offer_policy"])

    def test_known_and_mixed_history_with_null_targets_is_reference_only(self):
        payload = self.fixture_payload()
        for election in (payload["previous"], payload["latest"]):
            for offer in election["offers"]:
                offer["profiles"] = {
                    axis: {"bands": bands, "basis": "synthetic_offer_hypothesis",
                           "citation": "INVENTED", "available_on": "2020-01-01"}
                    for axis, bands in (("economic", [0]), ("social", [-1, 1]))
                }
        payload["target_profiles"] = {
            offer["id"]: {"economic": None, "social": None}
            for offer in payload["latest"]["offers"]
        }
        report = self.check_reference(payload)
        for election in (payload["previous"], payload["latest"]):
            year = str(election["year"])
            count = len(election["offers"])
            votes = sum(offer["votes"] for offer in election["offers"])
            self.assertEqual(votes, election["positive_votes"])
            for axis, mixed in (("economic", False), ("social", True)):
                self.assertEqual(report["audit"]["profile_coverage"][year][axis], {
                    "usable_offers": count, "unknown_offers": 0, "unknown_votes": 0,
                })
                self.assertEqual(report["audit"]["profile_breakdown"][year][axis], {
                    "known_offers": 0 if mixed else count,
                    "known_votes": 0 if mixed else votes,
                    "mixed_offers": count if mixed else 0,
                    "mixed_votes": votes if mixed else 0,
                    "unknown_offers": 0, "unknown_votes": 0,
                })
                for offer in election["offers"]:
                    detail = report["audit"]["profile_details"][year][offer["id"]][axis]
                    self.assertIs(detail["usable"], True)
                    self.assertIs(detail["mixed"], mixed)
        for axes in report["audit"]["offers"].values():
            for detail in axes.values():
                self.assertEqual(detail["reasons"], ["profile_unknown"])


class TestIdeologyTemporalBoundsPublicEntry(unittest.TestCase):
    # Reuse only the public invocation/envelope, not the baseline test selectors.
    invoke = TestIdeologyPublicEntry.invoke
    check_case = TestRemainingIdeologyPublicEntry.check_case
    check_reference = TestIdeologyMaskedReferencePublicEntry.check_reference

    def setUp(self):
        case = next(case for case in CORE_CASES
                    if case["test"] == "test_explicit_centre_is_not_unknown")
        self.payload = json.loads(case["stdin"])
        self.previous = self.payload["previous"]
        self.latest = self.payload["latest"]
        self.previous_offer = self.previous["offers"][0]
        self.latest_offer = self.latest["offers"][0]
        self.assertEqual(self.payload["forecast_origin"], "2026-01-01")
        self.assertEqual(self.payload["calibration_cuts"], [])
        for election, bands in ((self.previous, [0]), (self.latest, [2])):
            self.assertEqual(election["positive_votes"], 10)
            self.assertEqual(len(election["offers"]), 1)
            offer = election["offers"][0]
            self.assertEqual(offer["votes"], election["positive_votes"])
            self.assertEqual(offer["profiles"]["economic"]["bands"], bands)
        self.assertNotIn("target_profiles", self.payload)

    def explicit_target(self):
        # Independent target publication must not inherit the historical date.
        profile = dict(self.latest_offer["profiles"]["economic"])
        profile["available_on"] = "2020-01-01"
        self.payload["target_profiles"] = {
            self.latest_offer["id"]: {"economic": profile, "social": None},
        }

    def check_bounds(self, previous, latest, delta, signal, reasons):
        from fractions import Fraction

        report = self.check_case({
            "stdin": json.dumps(self.payload) + "\n", "exit": 0, "expect": {},
        })
        detail = report["audit"]["offers"][self.latest_offer["id"]]["economic"]
        self.assertIs(detail["usable"], True)
        self.assertEqual(detail["bounds"], [
            {"q": 2, "previous": previous, "latest": latest},
        ])
        self.assertEqual(detail["delta"], delta)
        self.assertEqual(detail["signal"], signal)
        self.assertEqual(detail["reasons"], reasons)
        reference = {}
        for offer in self.latest["offers"]:
            share = Fraction(offer["votes"], self.latest["positive_votes"])
            reference[offer["id"]] = {
                "numerator": share.numerator, "denominator": share.denominator,
            }
        self.assertEqual(report["reference_shares"], reference)
        self.assertEqual(report["shares"], reference)
        self.assertIsNone(report["beta"])
        self.assertEqual(report["audit"]["anchored_offers"], [])
        self.assertEqual(report["audit"]["reasons"], {"insufficient_calibration": 1})
        self.assertNotIn("profile_neither_axis_usable", report["audit"]["reasons"])
        return report

    def check_history(self, report, election, usable, reasons):
        year = str(election["year"])
        offers = election["offers"]
        for offer in offers:
            detail = report["audit"]["profile_details"][year][offer["id"]]["economic"]
            self.assertIs(detail["usable"], usable)
            self.assertIs(detail["mixed"], False)
            self.assertEqual(detail["reasons"], reasons)
        self.assertEqual(report["audit"]["profile_coverage"][year]["economic"], {
            "usable_offers": len(offers) if usable else 0,
            "unknown_offers": 0 if usable else len(offers),
            "unknown_votes": 0 if usable else sum(offer["votes"] for offer in offers),
        })

    def test_historical_publication_at_origin_retains_point_bounds(self):
        self.previous_offer["profiles"]["economic"]["available_on"] = "2026-01-01"
        self.explicit_target()
        report = self.check_bounds([0.5, 0.5], [1, 1], [0.5, 0.5], 0.5, [])
        self.check_history(report, self.previous, True, [])
        self.check_history(report, self.latest, True, [])

    def test_historical_publication_after_origin_expands_all_bands(self):
        self.previous_offer["profiles"]["economic"]["available_on"] = "2026-01-02"
        self.explicit_target()
        report = self.check_bounds([0, 1], [1, 1], [0, 1], None, ["trend_unidentified"])
        self.check_history(report, self.previous, False, ["profile_unavailable_at_origin"])
        self.check_history(report, self.latest, True, [])

    def test_current_hypothesis_at_origin_does_not_authenticate_history(self):
        profile = self.latest_offer["profiles"]["economic"]
        profile["available_on"] = None
        profile["hypothesis_on"] = "2026-01-01"
        report = self.check_bounds([0.5, 0.5], [0, 1], [-0.5, 0.5], None,
                                   ["trend_unidentified"])
        self.check_history(report, self.previous, True, [])
        self.check_history(report, self.latest, False, ["historical_publication_unknown"])
        self.assertIsNone(profile["available_on"])
        self.assertNotIn("target_profiles", self.payload)

    def test_current_hypothesis_after_origin_stays_masked(self):
        profile = self.latest_offer["profiles"]["economic"]
        profile["available_on"] = None
        profile["hypothesis_on"] = "2026-01-02"
        report = self.check_reference(self.payload)
        detail = report["audit"]["offers"][self.latest_offer["id"]]["economic"]
        self.assertEqual(detail["reasons"], ["historical_publication_unknown"])
        self.check_history(report, self.previous, True, [])
        self.check_history(report, self.latest, False, ["historical_publication_unknown"])
        self.assertEqual(report["audit"]["reasons"], {
            "insufficient_calibration": 1,
            "profile_neither_axis_usable": len(self.latest["offers"]),
        })
        self.assertIsNone(profile["available_on"])
        self.assertNotIn("target_profiles", self.payload)


class TestIdeologyRejectedCalibrationPublicEntry(unittest.TestCase):
    invoke = TestIdeologyPublicEntry.invoke
    check_case = TestRemainingIdeologyPublicEntry.check_case

    def setUp(self):
        from copy import deepcopy

        case = next(case for case in CORE_CASES
                    if case["test"] == "test_earlier_only_cut_reasons")
        self.payload = deepcopy(json.loads(case["stdin"]))
        self.rejected = deepcopy(case["expect"]["audit"]["calibration"]["rejected"])
        self.counts = {
            "outcome_not_known_before_origin": 1,
            "source_kind_not_official": 1,
            "election_type_not_general": 1,
            "historical_results_availability_unknown": 1,
        }

    def check_rejected_reference(self):
        report = self.check_case({
            "stdin": json.dumps(self.payload) + "\n", "exit": 0,
            "expect": {"status": "reference_only", "beta": None},
        })
        reference = {"a": {"numerator": 1, "denominator": 1}}
        self.assertEqual(report["reference_shares"], reference)
        self.assertEqual(report["shares"], reference)
        self.assertEqual(report["audit"]["anchored_offers"], ["a"])
        self.assertEqual(report["audit"]["calibration"], {
            "eligible": [], "rejected": self.rejected, "scores": [],
            "selected_by": "global_mean_tv_then_sum_then_e_then_s",
            "rejection_counts": self.counts,
        })
        for year in ("2023", "2025"):
            for axis in ("economic", "social"):
                self.assertEqual(report["audit"]["profile_coverage"][year][axis], {
                    "usable_offers": 0, "unknown_offers": 1, "unknown_votes": 10,
                })
        for detail in report["audit"]["offers"]["a"].values():
            self.assertIs(detail["usable"], False)
            self.assertEqual(detail["reasons"], ["profile_unknown"])
            self.assertEqual(detail["bounds"], [])
            self.assertIsNone(detail["delta"])
            self.assertIsNone(detail["signal"])

    def test_rejection_counts_preserve_all_cut_reasons(self):
        self.check_rejected_reference()

    def test_input_publication_at_cut_origin_is_not_late(self):
        self.payload["calibration_cuts"] = [{
            "id": "at-origin", "forecast_origin": "2022-01-01", "target_year": 2023,
            "previous": {"year": 2019, "available_on": "2022-01-01"},
            "latest": {"year": 2021, "available_on": "2022-01-01"},
            "outcome": {"year": 2023, "available_on": "2026-01-01"},
        }]
        self.rejected = [{"id": "at-origin", "reasons": ["outcome_not_known_before_origin"]}]
        self.counts = {"outcome_not_known_before_origin": 1}
        self.check_rejected_reference()

    def test_cut_scope_conflicts_are_independently_audited(self):
        cut = self.payload["calibration_cuts"][1]
        cut.update(source_kind="official", election_type="general",
                   category="DIPUTADOS", jurisdiction="pba:001")
        cut["previous"]["available_on"] = "2019-12-01"
        self.payload["calibration_cuts"] = [cut]
        self.rejected = [{"id": "bad-source", "reasons": [
            "category_not_comparable", "jurisdiction_not_comparable",
        ]}]
        self.counts = {"category_not_comparable": 1, "jurisdiction_not_comparable": 1}
        self.check_rejected_reference()

    def test_every_rejected_cut_contributes_to_reason_counts(self):
        from copy import deepcopy

        duplicate = deepcopy(self.payload["calibration_cuts"][0])
        duplicate["id"] = "leak-2"
        self.payload["calibration_cuts"].insert(1, duplicate)
        row = deepcopy(self.rejected[0])
        row["id"] = "leak-2"
        self.rejected.insert(1, row)
        self.counts["outcome_not_known_before_origin"] = 2
        self.check_rejected_reference()


class TestPendingIdeologyNumericalPipeline(unittest.TestCase):
    # Temporary stage boundaries; frozen future-success expectations stay intact.
    invoke = TestIdeologyPublicEntry.invoke

    def check_pending(self, payload):
        result = self.invoke(json.dumps(payload) + "\n")
        self.assertEqual(result.returncode, 2)
        self.assertEqual(result.stdout, "")
        self.assertEqual(result.stderr,
                         "error: synthetic pipeline processing is not implemented at this stage\n")

    def test_nonempty_cuts_cannot_bypass_calibration_when_root_is_masked(self):
        case = next(case for case in CORE_CASES
                    if case["test"] == "test_economic_independent_calibration_free_mass")
        payload = json.loads(case["stdin"])
        self.assertTrue(payload["calibration_cuts"])
        for election in (payload["previous"], payload["latest"]):
            for offer in election["offers"]:
                offer["profiles"] = {"economic": None, "social": None}
        payload["target_profiles"] = {
            offer["id"]: {"economic": None, "social": None}
            for offer in payload["latest"]["offers"]
        }
        self.check_pending(payload)


def public_case(case):
    def test(self):
        self.check_case(case)
    test.__doc__ = case["rule"]
    return test


for core_case in CORE_CASES:
    setattr(TestRemainingIdeologyPublicEntry, core_case["test"], public_case(core_case))


if __name__ == "__main__":
    # This new opt-in is a proposal, never a replay of the consumed grant.
    if "--expected-missing-entry-red" in sys.argv:
        sys.argv.remove("--expected-missing-entry-red")
        if tuple(sys.argv[1:]) not in (
            ("TestRemainingIdeologyPublicEntry",), SERIALIZATION_SELECTORS,
            STAGE1_DIAGNOSTIC_SELECTORS,
        ):
            raise RuntimeError("RED mode requires exact whole-core, ordered two-selector or ordered four-selector scope")
        EXPECT_MISSING_ENTRY_RED = True
    unittest.main(verbosity=2, testRunner=unittest.TextTestRunner(
        verbosity=2, resultclass=StopOnUnexpectedResult,
    ))
