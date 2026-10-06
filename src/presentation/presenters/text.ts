import { isRecord, type View } from './view';

type Row = { [key: string]: View };

function scalar(view: View): string {
  if (view === null) return '-';
  if (typeof view === 'object') return JSON.stringify(view);
  return String(view);
}

function isTabular(view: View): view is Row[] {
  return Array.isArray(view) && view.length > 0 && view.every(isRecord);
}

/** Renders an array of flat records as an aligned text table (nested values shown as compact JSON). */
export function renderTable(rows: readonly Row[]): string {
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const cells = rows.map((row) => columns.map((c) => scalar(row[c] ?? null)));
  const widths = columns.map((c, i) => Math.max(c.length, ...cells.map((r) => (r[i] as string).length)));
  const line = (values: string[]) =>
    values
      .map((v, i) => v.padEnd(widths[i] as number))
      .join('  ')
      .trimEnd();
  return [line(columns), line(widths.map((w) => '-'.repeat(w))), ...cells.map(line)].join('\n');
}

/**
 * Presents a view model for humans on a terminal: records as `key: value` lines, arrays of records as tables.
 * The CLI's `--json` flag bypasses this and prints the same view the MCP server returns.
 */
export function renderText(view: View, indent = ''): string {
  if (isTabular(view)) return indentBlock(renderTable(view), indent);
  if (Array.isArray(view)) {
    return view.length === 0 ? `${indent}(none)` : view.map((v) => `${indent}- ${scalar(v)}`).join('\n');
  }
  if (!isRecord(view)) return `${indent}${scalar(view)}`;
  const lines: string[] = [];
  for (const [key, value] of Object.entries(view)) {
    if (isTabular(value) || isRecord(value) || (Array.isArray(value) && value.length > 0)) {
      lines.push(`${indent}${key}:`, renderText(value, `${indent}  `));
    } else {
      lines.push(`${indent}${key}: ${Array.isArray(value) ? '(none)' : scalar(value)}`);
    }
  }
  return lines.join('\n');
}

function indentBlock(block: string, indent: string): string {
  return block
    .split('\n')
    .map((line) => indent + line)
    .join('\n');
}
