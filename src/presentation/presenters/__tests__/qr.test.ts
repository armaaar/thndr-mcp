import QRCode from 'qrcode';
import { describe, expect, it } from 'vitest';
import { renderQr } from '../qr';

const LINK =
  'thndr://goToRoute?routeName=HUMAN_ID&human_id=54&user_agent=thndr-mcp&requestId=0c6b3c2e-6f8a-4b1e-9d3f-2a7c5e8b9d10';

/** Reads the half-block drawing back into a matrix of light (true) / dark (false) modules. */
function decode(drawing: string): boolean[][] {
  const rows: boolean[][] = [];
  for (const line of drawing.split('\n')) {
    const chars = [...line];
    rows.push(chars.map((ch) => ch === '█' || ch === '▀'));
    rows.push(chars.map((ch) => ch === '█' || ch === '▄'));
  }
  return rows;
}

describe('renderQr', () => {
  it('draws exactly the QR modules, light as blocks, inside a one-module light quiet zone', () => {
    const { size, data } = QRCode.create(LINK, { errorCorrectionLevel: 'L' }).modules;
    const matrix = decode(renderQr(LINK));

    expect(matrix[0]?.every(Boolean)).toBe(true);
    expect(matrix[0]).toHaveLength(size + 2);
    for (let r = 0; r < size; r++) {
      expect(matrix[r + 1]?.[0]).toBe(true);
      expect(matrix[r + 1]?.[size + 1]).toBe(true);
      for (let c = 0; c < size; c++) expect(matrix[r + 1]?.[c + 1]).toBe(!data[r * size + c]);
    }
    expect(matrix[size + 1]?.every(Boolean)).toBe(true);
  });

  it('uses two modules per character row, so a 41-module code is 43 columns by 22 lines', () => {
    const lines = renderQr(LINK).split('\n');
    expect(QRCode.create(LINK, { errorCorrectionLevel: 'L' }).modules.size).toBe(41);
    expect(lines).toHaveLength(22);
    expect(lines.every((line) => [...line].length === 43)).toBe(true);
  });

  it('closes an even-sized drawing with a half row of quiet zone', () => {
    const lines = renderQr('x').split('\n');
    expect(lines.at(-1)).toMatch(/^[▀]+$/);
  });
});
