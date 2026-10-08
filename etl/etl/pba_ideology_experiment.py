"""Preliminary stdin-only entry; synthetic pipeline processing is not implemented."""

import argparse
import json
import sys


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
        payload = json.load(sys.stdin)
    except json.JSONDecodeError:
        sys.stderr.write("error: invalid JSON\n")
        return 2

    # These are preliminary discriminators, not full payload validation.
    if (
        not isinstance(payload, dict)
        or type(payload.get("schema_version")) is not int
        or payload["schema_version"] != 1
    ):
        sys.stderr.write("error: schema_version must be 1\n")
        return 2

    if payload.get("synthetic") is not True:
        sys.stderr.write("error: synthetic must be true; real inputs are not frozen\n")
        return 2

    if payload.get("source_kind") != "official":
        sys.stderr.write("error: source_kind must be official\n")
        return 2

    sys.stderr.write(
        "error: synthetic pipeline processing is not implemented at this stage\n"
    )
    return 2


if __name__ == "__main__":
    sys.exit(main())
