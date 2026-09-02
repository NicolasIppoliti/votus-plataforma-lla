"""Supply-chain regression tests for the executable release workflow."""

import re
from pathlib import Path
from typing import Any

import yaml
from yaml.nodes import MappingNode

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
WORKFLOW_RELATIVE_PATH = Path(".github/workflows/release-gates.yml")
WORKFLOW_PATH = REPOSITORY_ROOT / WORKFLOW_RELATIVE_PATH
FULL_COMMIT_ACTION_REF = re.compile(r"[^@\s]+@[0-9a-f]{40}")
APPROVED_NODE24_ACTION_REFS = {
    "actions/checkout": ("fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09", 3),
    "actions/setup-node": ("a0853c24544627f65ddf259abe73b1d18a591444", 2),
    "astral-sh/setup-uv": ("37802adc94f370d6bfd71619e3f0bf239e1f3b78", 1),
    "supabase/setup-cli": ("3c2f5e2ae34c34e428e8e206e2c4d21fa2d20fbf", 1),
}
_LINE = object()


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


def test_release_workflow_uses_approved_node24_action_refs_exactly_once() -> None:
    workflow_text = WORKFLOW_PATH.read_text(encoding="utf-8")
    action_refs = re.findall(r"^\s*- uses: (\S+)\s*$", workflow_text, re.MULTILINE)

    for action, (commit_sha, expected_count) in APPROVED_NODE24_ACTION_REFS.items():
        expected_ref = f"{action}@{commit_sha}"
        matching_refs = [ref for ref in action_refs if ref.partition("@")[0] == action]
        assert matching_refs == [expected_ref] * expected_count, (
            f"{WORKFLOW_RELATIVE_PATH} must use {expected_ref} exactly {expected_count} time(s); "
            f"found {matching_refs}"
        )


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
