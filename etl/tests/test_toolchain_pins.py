"""Repository install contracts; real frozen/cold installs are verified separately."""

import configparser
import json
import re
import tomllib
from pathlib import Path
from zipfile import ZipFile

import pytest
import yaml
from hatchling.build import build_editable, get_requires_for_build_editable
from packaging.requirements import Requirement

ROOT = Path(__file__).resolve().parents[2]
WEB = ROOT / "apps/web"


def test_web_dependencies_have_exact_matching_lock_resolutions() -> None:
    manifest = json.loads((WEB / "package.json").read_text())
    assert manifest["devDependencies"].get("supabase") == "2.116.0"
    documents = list(yaml.safe_load_all((WEB / "pnpm-lock.yaml").read_text()))
    dependency_lock = next(doc for doc in documents if "settings" in doc)
    importer = dependency_lock["importers"]["."]
    errors = []
    for group in ("dependencies", "devDependencies"):
        for name, specifier in manifest[group].items():
            version = specifier.rsplit("@", 1)[-1] if specifier.startswith("npm:") else specifier
            if not re.fullmatch(r"\d+\.\d+\.\d+", version):
                errors.append(f"{name} must use an exact version, not {specifier}")
            locked = importer[group].get(name)
            if locked is None or locked["specifier"] != specifier:
                errors.append(f"{name} is not synchronized with the lockfile")
    assert errors == []


def test_node_and_package_manager_pins_agree_with_install_requirements() -> None:
    manifest = json.loads((WEB / "package.json").read_text())
    node_file = ROOT / ".node-version"
    workspace_file = WEB / "pnpm-workspace.yaml"
    assert node_file.is_file(), "the Node runtime needs a shared version file"
    assert workspace_file.is_file(), "pnpm must reject mismatched tools instead of downloading them"
    node = node_file.read_text().strip()
    assert node == "24.21.0"
    assert manifest["engines"]["node"] == f"{node.split('.')[0]}.x"
    manager = manifest["packageManager"]
    assert manager == f"pnpm@{manifest['engines']['pnpm']}"
    workspace = yaml.safe_load(workspace_file.read_text())
    assert workspace["pmOnFail"] == "error"
    assert workspace["engineStrict"] is True
    assert workspace["saveExact"] is True
    assert workspace["packages"] == ["."]


def test_repository_root_exposes_the_same_pnpm_pin_without_a_new_workspace() -> None:
    root_manifest = ROOT / "package.json"
    assert root_manifest.is_file(), "Corepack must discover the pin from the repository root"
    root = json.loads(root_manifest.read_text())
    web = json.loads((WEB / "package.json").read_text())
    assert root == {"private": True, "packageManager": "pnpm@12.3.4"}
    assert root["packageManager"] == web["packageManager"]


def test_python_direct_dependencies_match_exact_locked_versions() -> None:
    project = tomllib.loads((ROOT / "etl/pyproject.toml").read_text())
    lock = tomllib.loads((ROOT / "etl/uv.lock").read_text())
    versions = {package["name"]: package["version"] for package in lock["package"]}
    requirements = [
        *project["project"]["dependencies"],
        *(requirement for group in project["dependency-groups"].values() for requirement in group),
        *project["build-system"]["requires"],
    ]
    errors = []
    for raw_requirement in requirements:
        requirement = Requirement(raw_requirement)
        locked = versions.get(requirement.name)
        if locked is None or str(requirement.specifier) != f"=={locked}":
            errors.append(f"{raw_requirement} must match one exact locked version")
    assert errors == []


def test_python_build_backend_uses_the_default_locked_dependency_graph() -> None:
    project = tomllib.loads((ROOT / "etl/pyproject.toml").read_text())
    lock = tomllib.loads((ROOT / "etl/uv.lock").read_text())
    python_file = ROOT / ".python-version"
    assert python_file.is_file(), "the ETL runtime needs a shared version file"
    assert re.fullmatch(r"\d+\.\d+\.\d+", python_file.read_text().strip())
    uv = project["tool"].get("uv", {})
    assert re.fullmatch(r"==\d+\.\d+\.\d+", uv.get("required-version", ""))
    assert set(uv["default-groups"]) == {"dev", "build"}
    assert uv["no-build-isolation-package"] == ["etl"]
    assert set(project["build-system"]["requires"]) <= set(project["dependency-groups"]["build"])
    packages = {package["name"]: package for package in lock["package"]}
    backend = packages.get("hatchling")
    assert backend is not None, "isolated Hatchling dependencies must not float outside uv.lock"
    assert backend["dependencies"]
    assert all(dependency["name"] in packages for dependency in backend["dependencies"])
    etl = packages["etl"]
    assert {"name": "hatchling"} in etl["dev-dependencies"]["build"]


def test_default_editable_build_exposes_the_etl_verification_entrypoint(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.chdir(ROOT / "etl")
    wheel = build_editable(str(tmp_path))
    with ZipFile(tmp_path / wheel) as archive:
        entrypoints = configparser.ConfigParser()
        entrypoints.read_string(archive.read("etl-0.1.0.dist-info/entry_points.txt").decode())
        assert entrypoints["console_scripts"]["etl-verify"] == "etl.verify:main"
        source_pointers = [name for name in archive.namelist() if name.endswith(".pth")]
        assert any(
            str(ROOT / "etl") in archive.read(name).decode().splitlines()
            for name in source_pointers
        )

    project = tomllib.loads((ROOT / "etl/pyproject.toml").read_text())
    build_group = {
        Requirement(raw).name: Requirement(raw) for raw in project["dependency-groups"]["build"]
    }
    for raw_requirement in get_requires_for_build_editable():
        requirement = Requirement(raw_requirement)
        assert requirement.name in build_group, (
            f"unlocked editable build requirement: {requirement}"
        )
        pinned = list(build_group[requirement.name].specifier)
        assert len(pinned) == 1 and pinned[0].operator == "=="
        assert pinned[0].version in requirement.specifier
