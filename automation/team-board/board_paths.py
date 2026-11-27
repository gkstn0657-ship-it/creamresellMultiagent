"""Resolve board storage from this checkout, including the original split installation."""

import os
from pathlib import Path


PROJECT = Path(__file__).resolve().parents[2]


def configured_path(name, default, project=PROJECT):
    value = os.environ.get(name)
    return (project / Path(value).expanduser()).resolve() if value else default


def split_ledger(project):
    ledger = project.parent / "Cream" / "kream-runs" / "agent-teams"
    if (project.parent.name.casefold() == "1109renew" and ledger.parent.parent != project
            and (ledger / "work-orders").is_dir()):
        return ledger
    return None


def report_directory(project=PROJECT):
    base = project.parent.parent if split_ledger(project) else project
    return configured_path("CREAM_REPORTS_DIR", base / "상품탐색결과", project)


def ledger_directories(project=PROJECT):
    multiple = os.environ.get("TEAM_BOARD_KREAM_ROOTS")
    if multiple:
        paths = [project / Path(p).expanduser() for p in multiple.split(os.pathsep) if p]
    elif os.environ.get("CREAM_AGENT_TEAMS_ROOT"):
        paths = [configured_path("CREAM_AGENT_TEAMS_ROOT", None, project)]
    else:
        legacy = split_ledger(project)
        paths = ([legacy] if legacy else []) + [project / "kream-runs" / "agent-teams"]
    return tuple(dict.fromkeys(p.resolve() for p in paths))
