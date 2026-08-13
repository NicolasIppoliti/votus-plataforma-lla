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

    assert checkout_step_count > 0, f"{WORKFLOW_RELATIVE_PATH} must use actions/checkout"
    assert not violations, "Release workflow supply-chain violations:\n" + "\n".join(violations)
