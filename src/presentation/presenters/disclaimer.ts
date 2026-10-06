/**
 * The short disclaimer shown wherever a person meets the tool: CLI help and login, MCP server instructions and the
 * browser login page. The full text is DISCLAIMER.md.
 */
export const SHORT_DISCLAIMER =
  'thndr-mcp is an unofficial community project, not affiliated with or endorsed by Thndr, its partners, any ' +
  'exchange or any regulator. It uses Thndr’s private API, which may change or break, and is provided "AS IS" ' +
  'without warranty. Nothing it or an AI assistant produces is financial advice: check figures in the Thndr app, ' +
  'and use it at your own risk and in line with Thndr’s terms and your local laws.';

/** {@link SHORT_DISCLAIMER} for a terminal: wrapped to `width` columns, with where to read the full text. */
export function terminalDisclaimer(width = 100): string {
  const lines: string[] = [];
  let line = '';
  for (const word of `${SHORT_DISCLAIMER} Full text: DISCLAIMER.md.`.split(' ')) {
    if (line && line.length + 1 + word.length > width) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines.join('\n');
}
