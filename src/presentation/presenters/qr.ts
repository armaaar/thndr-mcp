import QRCode from 'qrcode';

/** Quiet zone in modules. The standard asks for 4; on a screen, 1 scans reliably and keeps the code small. */
const MARGIN = 1;

/**
 * Renders `text` as the smallest terminal QR code: Unicode half blocks, two modules per character cell, low error
 * correction. ThndrX shows the device-approval deep link the same way (as a QR).
 *
 * Light modules are drawn as blocks and dark modules as blanks, so on a dark terminal (the usual Claude Code theme)
 * the code reads dark-on-light like a printed one, with a light quiet zone around it.
 */
export function renderQr(text: string): string {
  const { size, data } = QRCode.create(text, { errorCorrectionLevel: 'L' }).modules;
  const total = size + 2 * MARGIN;
  const light = (row: number, col: number): boolean => {
    const r = row - MARGIN;
    const c = col - MARGIN;
    return r < 0 || c < 0 || r >= size || c >= size || !data[r * size + c];
  };
  const lines: string[] = [];
  for (let row = 0; row < total; row += 2) {
    let line = '';
    for (let col = 0; col < total; col++) {
      const top = light(row, col);
      const bottom = row + 1 < total ? light(row + 1, col) : false;
      line += top && bottom ? '█' : top ? '▀' : bottom ? '▄' : ' ';
    }
    lines.push(line);
  }
  return lines.join('\n');
}
