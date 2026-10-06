"""List the API paths in decompiled Thndr app code, or show the code around one of them.

    python3 -I find-endpoints.py <decompiled-dir>                       # every API path literal, with counts
    python3 -I find-endpoints.py <decompiled-dir> --grep <text> [-C 8]  # each hit with surrounding lines
    python3 -I find-endpoints.py <decompiled-dir> --markets             # lines mentioning a market code

Reads the decompiler's text output (decompiled.js / disassembly.hasm) as data; it imports nothing from it.
"""

import argparse
import collections
import pathlib
import re
import sys

PATH = re.compile(
    r"""["'`](/?(?:[a-z0-9-]+-service|krakend-thndr-x|portfolio|price-alerts|securities|feed|trading-journals|"""
    r"""savings|notifications|api|users-service|auth|thndrx|payment-service|funding-service)/[A-Za-z0-9_./{}$:-]*)"""
)
MARKETS = re.compile(r"""["'`](egypt|us|adsm|abudhabi|simulator|EGID|ALPACA|ALPACA_UAE|NOPL|INDX)["'`]""")


def sources(directory: pathlib.Path) -> list[pathlib.Path]:
    files = [p for p in directory.rglob("*") if p.is_file() and p.suffix in {".js", ".hasm", ".txt"}]
    if not files:
        sys.exit(f"No decompiled .js/.hasm files under {directory}")
    return sorted(files)


def list_paths(files: list[pathlib.Path]) -> None:
    counts: collections.Counter[str] = collections.Counter()
    for file in files:
        with file.open(encoding="utf-8", errors="replace") as handle:
            for line in handle:
                counts.update(match.group(1) for match in PATH.finditer(line))
    for path, count in sorted(counts.items()):
        print(f"{count:5d}  {path}")
    print(f"\n{len(counts)} distinct paths", file=sys.stderr)


def grep(files: list[pathlib.Path], needle: re.Pattern[str], context: int, limit: int) -> None:
    shown = 0
    for file in files:
        lines = file.read_text(encoding="utf-8", errors="replace").splitlines()
        for index, line in enumerate(lines):
            if not needle.search(line):
                continue
            start, end = max(0, index - context), min(len(lines), index + context + 1)
            print(f"── {file.name}:{index + 1}")
            for number in range(start, end):
                marker = ">" if number == index else " "
                print(f"{marker}{number + 1:8d}  {lines[number][:240]}")
            shown += 1
            if shown >= limit:
                print(f"… stopped after {limit} hits (raise --limit)", file=sys.stderr)
                return


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("directory", type=pathlib.Path)
    parser.add_argument("--grep", help="text (regular expression) to show in context")
    parser.add_argument("--markets", action="store_true", help="show lines mentioning a market code")
    parser.add_argument("-C", "--context", type=int, default=8)
    parser.add_argument("--limit", type=int, default=40)
    args = parser.parse_args()
    files = sources(args.directory)
    if args.grep:
        grep(files, re.compile(args.grep), args.context, args.limit)
    elif args.markets:
        grep(files, MARKETS, args.context, args.limit)
    else:
        list_paths(files)


if __name__ == "__main__":
    main()
