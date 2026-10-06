"""Dump the Hermes string table of the Thndr app bundle, one string per line with its index.

    .cache/thndr-mobile/venv/bin/python -I dump-strings.py <index.android.bundle> <out.tsv>

Run it with the virtualenv that decompile.sh creates (it needs hermes-dec's parser). The bundle is parsed as data;
nothing in it is executed. Escapes backslashes and line breaks so each string stays on one line, which makes the file
easy to grep for paths, flag names and market codes.
"""

import sys

from hermes_dec.parsers.hbc_file_parser import HBCReader


def main() -> None:
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    source, target = sys.argv[1], sys.argv[2]
    reader = HBCReader()
    with open(source, "rb") as handle:
        reader.read_whole_file(handle)
    print(
        f"bytecode v{reader.header.version}: {len(reader.strings)} strings, "
        f"{len(reader.function_headers)} functions"
    )
    with open(target, "w", encoding="utf-8", errors="surrogatepass") as out:
        for index, text in enumerate(reader.strings):
            escaped = text.replace("\\", "\\\\").replace("\n", "\\n").replace("\r", "\\r")
            out.write(f"{index}\t{escaped}\n")


if __name__ == "__main__":
    main()
