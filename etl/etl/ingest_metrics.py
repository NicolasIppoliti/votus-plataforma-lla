"""Optional application observations; no database durability or conservation claims."""

import json
import os
import sys
from contextlib import contextmanager
from pathlib import Path


class MetricsReportError(ValueError):
    """A safe, controlled report-destination or publication failure."""


class IngestMetrics:
    def __init__(self):
        self.data = {
            "version": 1, "scope": None, "status": "failed", "commit_returned": False,
            "first_pass": "not_started", "iteration": "not_started",
            "records_seen": None, "rows_emitted": None, "candidate_keys": None,
            "exclusions": None, "ambiguous_categories": None, "companion_conflicts": None,
        }

    def record_exclusion(self, reason: str, votes: int | None, rows: int = 1):
        bucket = self.data["exclusions"].setdefault(
            reason, {"rows": 0, "parseable_votes": 0, "unreadable_vote_rows": 0},
        )
        bucket["rows"] += rows
        bucket["parseable_votes"] += votes if votes is not None else 0
        bucket["unreadable_vote_rows"] += rows if votes is None else 0


@contextmanager
def metrics_report(path: Path, *, archive_root: Path, protected: tuple[Path, ...]):
    """Reserve a new file before ingestion; never publish inside its transaction."""
    metrics = IngestMetrics()
    try:
        destination = path.resolve()
        if destination.is_relative_to(archive_root.resolve()) or destination in {
            item.resolve() for item in protected
        }:
            raise MetricsReportError("metrics destination is a protected input or archive path")
        stream = path.open("x", encoding="utf-8")
    except OSError:
        raise MetricsReportError("metrics destination unavailable; ingestion not started") from None

    propagating = False
    try:
        yield metrics
    except BaseException:
        propagating = True
        raise
    finally:
        try:
            with stream:
                if path.stat() != os.fstat(stream.fileno()):
                    raise OSError("reserved destination changed")
                json.dump(metrics.data, stream, ensure_ascii=True, sort_keys=True)
                stream.write("\n")
                stream.flush()
                os.fsync(stream.fileno())
        except (OSError, ValueError):
            message = (
                "metrics publication failed; commit_returned="
                + str(metrics.data["commit_returned"]).lower()
                + " (application observation, not a rollback claim)"
            )
            if propagating:
                print(f"error: {message}", file=sys.stderr)
            else:
                raise MetricsReportError(message) from None
