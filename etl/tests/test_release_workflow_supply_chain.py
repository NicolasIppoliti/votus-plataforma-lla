"""Supply-chain regression tests for the executable release workflow."""

import re
from pathlib import Path
from typing import Any

import pytest
import yaml
from yaml.nodes import MappingNode

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
WORKFLOW_RELATIVE_PATH = Path(".github/workflows/release-gates.yml")
WORKFLOW_PATH = REPOSITORY_ROOT / WORKFLOW_RELATIVE_PATH
FULL_COMMIT_ACTION_REF = re.compile(r"[^@\s]+@[0-9a-f]{40}")
APPROVED_NODE24_ACTION_REFS = {
    "actions/checkout": ("fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09", 5),
    "actions/setup-node": ("a0853c24544627f65ddf259abe73b1d18a591444", 4),
    "pnpm/action-setup": ("fc06bc1257f339d1d5d8b3a19a8cae5388b55320", 3),
    "astral-sh/setup-uv": ("37802adc94f370d6bfd71619e3f0bf239e1f3b78", 1),
    "supabase/setup-cli": ("3c2f5e2ae34c34e428e8e206e2c4d21fa2d20fbf", 3),
    "actions/upload-artifact": ("043fb46d1a93c77aae656e7c1c64a875d1fc6a0a", 1),
}
_LINE = object()


def _assert_independent_release_jobs(jobs: dict[str, Any]) -> None:
    for name in ("web-static", "etl-release", "e2e-release", "e2e-sql"):
        logical_gate = "e2e-release" if name == "e2e-sql" else name
        assert name in jobs
        assert jobs[name]["needs"] == "scope"
        assert jobs[name]["if"] == (
            "${{ !cancelled() && needs.scope.result == 'success' && "
            f"contains(fromJSON(needs.scope.outputs.gates || '[]'), '{logical_gate}') }}" + "}"
        )
        if name == "etl-release":
            assert jobs[name]["strategy"] == {
                "fail-fast": False,
                "matrix": {"case": ["ordinary", "success", "ledger", "sql"]},
            }
        else:
            assert "strategy" not in jobs[name]


@pytest.mark.parametrize("name", ["web-static", "etl-release", "e2e-release", "e2e-sql"])
@pytest.mark.parametrize("condition", ['{"if": false}', '\n  "if": false\n'])
def test_release_job_conditions_cannot_hide_in_yaml_formatting(name: str, condition: str) -> None:
    jobs = yaml.safe_load(WORKFLOW_PATH.read_text(encoding="utf-8"))["jobs"]
    _assert_independent_release_jobs(jobs)
    jobs[name].update(yaml.safe_load(condition))
    with pytest.raises(AssertionError):
        _assert_independent_release_jobs(jobs)


@pytest.mark.parametrize("name", ["web-static", "etl-release", "e2e-release", "e2e-sql"])
def test_release_jobs_cannot_be_serialized(name: str) -> None:
    jobs = yaml.safe_load(WORKFLOW_PATH.read_text(encoding="utf-8"))["jobs"]
    _assert_independent_release_jobs(jobs)
    jobs[name]["needs"] = ["scope", "etl-release" if name == "web-static" else "web-static"]
    with pytest.raises(AssertionError):
        _assert_independent_release_jobs(jobs)


@pytest.mark.parametrize("name", ["web-static", "e2e-release", "e2e-sql"])
def test_only_etl_release_can_have_a_strategy(name: str) -> None:
    jobs = yaml.safe_load(WORKFLOW_PATH.read_text(encoding="utf-8"))["jobs"]
    _assert_independent_release_jobs(jobs)
    jobs[name]["strategy"] = jobs["etl-release"]["strategy"]
    with pytest.raises(AssertionError):
        _assert_independent_release_jobs(jobs)


@pytest.mark.parametrize(
    "strategy",
    [
        {"fail-fast": True, "matrix": {"case": ["ordinary", "success", "ledger", "sql"]}},
        {"fail-fast": False, "matrix": {"case": ["ordinary", "success", "sql"]}},
        {"fail-fast": False, "matrix": {"case": ["ordinary", "success", "ledger", "sql", "extra"]}},
    ],
)
def test_etl_matrix_cannot_cancel_or_change_required_cases(strategy: dict[str, Any]) -> None:
    jobs = yaml.safe_load(WORKFLOW_PATH.read_text(encoding="utf-8"))["jobs"]
    _assert_independent_release_jobs(jobs)
    jobs["etl-release"]["strategy"] = strategy
    with pytest.raises(AssertionError):
        _assert_independent_release_jobs(jobs)


def test_review_diagnostic_upload_is_failure_only_and_narrowly_scoped() -> None:
    workflow = yaml.safe_load(WORKFLOW_PATH.read_text(encoding="utf-8"))
    _assert_independent_release_jobs(workflow["jobs"])
    assert workflow["jobs"]["verify"]["if"] == "${{ always() }}"
    aggregate = workflow["jobs"]["verify"]
    assert aggregate["needs"] == ["scope", "web-static", "etl-release", "e2e-release", "e2e-sql"]
    for name in aggregate["needs"]:
        variable = name.upper().replace("-", "_") + "_RESULT"
        assert aggregate["env"][variable] == f"${{{{ needs.{name}.result }}}}"
    assert workflow["jobs"]["scope"]["outputs"] == {
        "gates": "${{ steps.publish.outputs.gates }}",
        "supabase": "${{ steps.publish.outputs.supabase }}",
        "python": "${{ steps.publish.outputs.python }}",
    }
    assert aggregate["env"]["SCOPE_GATES"] == "${{ needs.scope.outputs.gates }}"
    # Runtime permutations are exercised by the web workflow-boundary tests.
    assert aggregate["steps"][0]["shell"] == "bash"
    assert (
        aggregate["steps"][0]["run"]
        == """\
test "$SCOPE_RESULT" = "success"
case "$SCOPE_GATES" in
  '["web-static","etl-release","e2e-release"]')
    web=success; etl=success; e2e=success ;;
  '["etl-release"]')
    web=skipped; etl=success; e2e=skipped ;;
  '["web-static","e2e-release"]')
    web=success; etl=skipped; e2e=success ;;
  *) echo "Invalid scope gates" >&2; exit 1 ;;
esac
test "$WEB_STATIC_RESULT" = "$web"
test "$ETL_RELEASE_RESULT" = "$etl"
test "$E2E_RELEASE_RESULT" = "$e2e"
test "$E2E_SQL_RESULT" = "$e2e"
"""
    )
    uploads = [
        (job_name, index, step)
        for job_name, job in workflow["jobs"].items()
        for index, step in enumerate(job["steps"])
        if step.get("uses", "").startswith("actions/upload-artifact@")
    ]
    assert len(uploads) == 1
    job_name, index, upload = uploads[0]
    assert job_name == "e2e-release"
    gate = workflow["jobs"][job_name]["steps"][index - 1]
    assert gate["run"] == "pnpm test:e2e:gate --lane browser"
    assert gate["working-directory"] == "apps/web"
    assert upload["uses"] == ("actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a")
    assert upload["if"] == "${{ failure() }}"
    assert upload["with"] == {
        "name": "review-focus-geometry",
        "path": (
            "apps/web/test-results/**/review-focus-geometry.json\n"
            "apps/web/test-results/**/review-scroll-completion.json\n"
        ),
        "retention-days": 1,
        "include-hidden-files": False,
        "if-no-files-found": "ignore",
    }
    assert "continue-on-error" not in gate
    assert workflow["permissions"] == {"contents": "read"}


def _assert_sql_lane(job: dict[str, Any]) -> None:
    assert job["runs-on"] == "ubuntu-24.04"
    assert job["timeout-minutes"] == 20
    assert "services" not in job
    assert "continue-on-error" not in job
    steps = job["steps"]
    assert len(steps) == 6
    assert [step["uses"].partition("@")[0] for step in steps[:4]] == [
        "actions/checkout",
        "pnpm/action-setup",
        "actions/setup-node",
        "supabase/setup-cli",
    ]
    assert steps[0]["with"] == {"persist-credentials": False}
    assert steps[1]["with"] == {"package_json_file": "apps/web/package.json"}
    assert steps[2]["with"] == {
        "node-version-file": ".node-version",
        "cache": "pnpm",
        "cache-dependency-path": "apps/web/pnpm-lock.yaml",
    }
    assert steps[3]["with"] == {"version": "${{ needs.scope.outputs.supabase }}"}
    assert steps[4:] == [
        {"run": "pnpm install --frozen-lockfile", "working-directory": "apps/web"},
        {"run": "pnpm test:e2e:gate --lane sql", "working-directory": "apps/web"},
    ]
    assert all("if" not in step and "continue-on-error" not in step for step in steps)


def test_scope_disables_automatic_pnpm_cache_without_changing_downstream_caches() -> None:
    jobs = yaml.safe_load(WORKFLOW_PATH.read_text(encoding="utf-8"))["jobs"]
    setup_steps = {
        name: next(
            step for step in job["steps"] if step.get("uses", "").startswith("actions/setup-node@")
        )
        for name, job in jobs.items()
        if any(step.get("uses", "").startswith("actions/setup-node@") for step in job["steps"])
    }
    assert setup_steps["scope"]["with"] == {
        "node-version-file": ".node-version",
        "package-manager-cache": False,
    }
    for name in ("web-static", "e2e-release", "e2e-sql"):
        assert setup_steps[name]["with"] == {
            "node-version-file": ".node-version",
            "cache": "pnpm",
            "cache-dependency-path": "apps/web/pnpm-lock.yaml",
        }


def test_sql_lane_has_only_pinned_setup_install_and_complete_sql_command() -> None:
    jobs = yaml.safe_load(WORKFLOW_PATH.read_text(encoding="utf-8"))["jobs"]
    assert "e2e-sql" in jobs
    _assert_sql_lane(jobs["e2e-sql"])


@pytest.mark.parametrize(
    "mutation",
    [
        {"run": "pnpm test:e2e:gate --scale-proof-only"},
        {"run": "pnpm test:e2e:gate"},
        {"if": "${{ failure() }}"},
        {"continue-on-error": True},
        {"working-directory": "."},
    ],
)
def test_sql_lane_cannot_reduce_or_mask_required_proofs(mutation: dict[str, Any]) -> None:
    jobs = yaml.safe_load(WORKFLOW_PATH.read_text(encoding="utf-8"))["jobs"]
    assert "e2e-sql" in jobs
    job = jobs["e2e-sql"]
    _assert_sql_lane(job)
    job["steps"][-1].update(mutation)
    with pytest.raises(AssertionError):
        _assert_sql_lane(job)


class _LineLoader(yaml.SafeLoader):
    pass


def _construct_mapping(
    loader: yaml.SafeLoader, node: MappingNode, deep: bool = False
) -> dict[Any, Any]:
    mapping = yaml.SafeLoader.construct_mapping(loader, node, deep=deep)
    mapping[_LINE] = node.start_mark.line + 1
    return mapping


_LineLoader.add_constructor(
    yaml.resolver.BaseResolver.DEFAULT_MAPPING_TAG,
    _construct_mapping,
)


def test_release_workflow_uses_approved_node24_action_refs_at_exact_counts() -> None:
    workflow_text = WORKFLOW_PATH.read_text(encoding="utf-8")
    action_refs = re.findall(r"^\s*- uses: (\S+)\s*$", workflow_text, re.MULTILINE)

    for action, (commit_sha, expected_count) in APPROVED_NODE24_ACTION_REFS.items():
        expected_ref = f"{action}@{commit_sha}"
        matching_refs = [ref for ref in action_refs if ref.partition("@")[0] == action]
        assert matching_refs == [expected_ref] * expected_count, (
            f"{WORKFLOW_RELATIVE_PATH} must use {expected_ref} exactly {expected_count} time(s); "
            f"found {matching_refs}"
        )


def test_supabase_cli_versions_are_pinned_to_their_exact_release_jobs() -> None:
    jobs = yaml.safe_load(WORKFLOW_PATH.read_text(encoding="utf-8"))["jobs"]
    setups = [
        (name, step["uses"], step["with"])
        for name, job in jobs.items()
        for step in job["steps"]
        if step.get("uses", "").startswith("supabase/setup-cli@")
    ]
    reference = "supabase/setup-cli@3c2f5e2ae34c34e428e8e206e2c4d21fa2d20fbf"
    assert setups == [
        ("etl-release", reference, {"version": "${{ needs.scope.outputs.supabase }}"}),
        ("e2e-release", reference, {"version": "${{ needs.scope.outputs.supabase }}"}),
        ("e2e-sql", reference, {"version": "${{ needs.scope.outputs.supabase }}"}),
    ]


def test_release_workflow_actions_are_immutable_and_checkout_drops_credentials() -> None:
    loader = _LineLoader(WORKFLOW_PATH.read_text(encoding="utf-8"))
    try:
        workflow = loader.get_single_data()
    finally:
        loader.dispose()

    assert isinstance(workflow, dict), f"{WORKFLOW_RELATIVE_PATH} must be a YAML mapping"
    jobs = workflow.get("jobs")
    assert isinstance(jobs, dict), f"{WORKFLOW_RELATIVE_PATH} must define jobs"

    action_steps: list[tuple[str, int, dict[Any, Any]]] = []
    for job_name, job in jobs.items():
        if not isinstance(job_name, str) or not isinstance(job, dict):
            continue
        steps = job.get("steps", [])
        assert isinstance(steps, list), f"jobs.{job_name}.steps must be a sequence"
        action_steps.extend(
            (job_name, index, step)
            for index, step in enumerate(steps)
            if isinstance(step, dict) and "uses" in step
        )

    assert action_steps, f"{WORKFLOW_RELATIVE_PATH} must contain action steps"
    checkout_step_count = 0
    violations: list[str] = []

    for job_name, step_index, step in action_steps:
        action_ref = step["uses"]
        location = f"{WORKFLOW_RELATIVE_PATH}:{step[_LINE]}"
        step_path = f"jobs.{job_name}.steps[{step_index}]"
        if not isinstance(action_ref, str) or FULL_COMMIT_ACTION_REF.fullmatch(action_ref) is None:
            violations.append(
                f"{location} ({step_path}.uses): {action_ref!r} must end in a full lowercase "
                "40-hex commit SHA"
            )

        if not isinstance(action_ref, str) or action_ref.partition("@")[0] != "actions/checkout":
            continue

        checkout_step_count += 1
        inputs = step.get("with")
        if not isinstance(inputs, dict) or inputs.get("persist-credentials") is not False:
            violations.append(
                f"{location} ({step_path}): actions/checkout must explicitly set "
                "with.persist-credentials to false"
            )

    expected_checkout_count = APPROVED_NODE24_ACTION_REFS["actions/checkout"][1]
    assert checkout_step_count == expected_checkout_count, (
        f"{WORKFLOW_RELATIVE_PATH} must use actions/checkout exactly "
        f"{expected_checkout_count} time(s); found {checkout_step_count}"
    )
    assert not violations, "Release workflow supply-chain violations:\n" + "\n".join(violations)
