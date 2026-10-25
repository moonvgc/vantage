// One-off generator: writes build/icon.ico (multi-size) + build/icon.png from the
// Vantage mark geometry in src/components/Icons.jsx (zero deps — hand-rolled
// PNG/ICO encoders). Run: node scripts/make-icon.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outDir = path.join(root, 'build');
mkdirSync(outDir, { recursive: true });

// Vantage mark, in a 20-unit design space shared with BrandMark in src/components/Icons.jsx:
// a dark rounded tile, a coral→red left stroke running down to the point of the V, and a shorter
// white right stroke that stops before it — the gap is the "vantage point".
const BG_TOP = [27, 27, 38];     // #1B1B26
const BG_BOTTOM = [12, 12, 18];  // #0C0C12
const CORAL = [255, 122, 89];    // #FF7A59
const RED = [255, 70, 85];       // #FF4655
const WHITE = [245, 245, 250];

const LEFT_STROKE = [[2.6, 3.6], [6.6, 3.6], [11.4, 16.4], [8.6, 16.4]];
const RIGHT_STROKE = [[17.4, 3.6], [13.4, 3.6], [10.9, 10.2], [12.9, 13.2]];

const mix = (a, b, t) => a.map((value, index) => Math.round(value + (b[index] - value) * t));

function inPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function inRoundedSquare(x, y, size, radius) {
  const cx = Math.min(Math.max(x, radius), size - radius);
  const cy = Math.min(Math.max(y, radius), size - radius);
  return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2;
}

function renderMark(size) {
  const ss = 4;
  const W = size * ss;
  const out = Buffer.alloc(size * size * 4);
  // The glyph sits inside the tile with a margin; small sizes get a bigger glyph so it stays legible.
  const pad = size <= 32 ? 0.04 : 0.1;
  const scale = (W * (1 - pad * 2)) / 20;
  const offset = W * pad;
  const radius = W * 0.22;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0; let g = 0; let b = 0; let a = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const px = x * ss + sx + 0.5;
          const py = y * ss + sy + 0.5;
          if (!inRoundedSquare(px, py, W, radius)) continue;
          const ux = (px - offset) / scale;
          const uy = (py - offset) / scale;
          let color = mix(BG_TOP, BG_BOTTOM, py / W);
          if (inPoly(ux, uy, LEFT_STROKE)) color = mix(CORAL, RED, (uy - 3.6) / 12.8);
          else if (inPoly(ux, uy, RIGHT_STROKE)) color = WHITE;
          r += color[0]; g += color[1]; b += color[2]; a += 1;
        }
      }
      const o = (y * size + x) * 4;
      if (a) { out[o] = Math.round(r / a); out[o + 1] = Math.round(g / a); out[o + 2] = Math.round(b / a); }
      out[o + 3] = Math.round((a / (ss * ss)) * 255);
    }
  }
  return out;
}

// PNG writer (deflate + CRC32)
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function toPNG(rgba, size) {
  const sig = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

// BMP (DIB) entry: BITMAPINFOHEADER + 32-bit BGRA rows (bottom-up) + the 1bpp AND mask.
function toBMP(rgba, size) {
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);               // biSize
  header.writeInt32LE(size, 4);              // biWidth
  header.writeInt32LE(size * 2, 8);          // biHeight: XOR bitmap + AND mask
  header.writeUInt16LE(1, 12);               // biPlanes
  header.writeUInt16LE(32, 14);              // biBitCount
  header.writeUInt32LE(0, 16);               // biCompression: BI_RGB
  header.writeUInt32LE(size * size * 4, 20); // biSizeImage

  const xor = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const src = ((size - 1 - y) * size + x) * 4; // rows are stored bottom-up
      const dst = (y * size + x) * 4;
      xor[dst] = rgba[src + 2];      // B
      xor[dst + 1] = rgba[src + 1];  // G
      xor[dst + 2] = rgba[src];      // R
      xor[dst + 3] = rgba[src + 3];  // A
    }
  }

  // AND mask: 1bpp, each row padded to 4 bytes. All zero — the alpha channel carries transparency.
  const and = Buffer.alloc(Math.ceil(size / 32) * 4 * size, 0);
  return Buffer.concat([header, xor, and]);
}

// ICO writer. PNG compression is ONLY valid for the 256px entry: Windows renders the smaller PNG
// entries as the default icon, so the taskbar and Start menu showed Electron's mark while Task
// Manager showed the gem — Task Manager reads a size that decodes, the shell reads one that does not.
// Every size below 256 is therefore written as a BMP entry.
function toICO(images) {
  const count = images.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(count, 4);
  const dirSize = 16 * count;
  let offset = 6 + dirSize;
  const entries = [];
  const blobs = [];
  for (const { size, data } of images) {
    const dirEntry = Buffer.alloc(16);
    dirEntry.writeUInt8(size >= 256 ? 0 : size, 0);
    dirEntry.writeUInt8(size >= 256 ? 0 : size, 1);
    dirEntry.writeUInt8(0, 2); dirEntry.writeUInt8(0, 3);
    dirEntry.writeUInt16LE(1, 4); dirEntry.writeUInt16LE(32, 6);
    dirEntry.writeUInt32LE(data.length, 8);
    dirEntry.writeUInt32LE(offset, 12);
    offset += data.length;
    entries.push(dirEntry);
    blobs.push(data);
  }
  return Buffer.concat([header, ...entries, ...blobs]);
}

const sizes = [16, 24, 32, 48, 64, 128, 256];
const images = sizes.map((size) => {
  const rgba = renderMark(size);
  return { size, data: size >= 256 ? toPNG(rgba, size) : toBMP(rgba, size) };
});

writeFileSync(path.join(outDir, 'icon.ico'), toICO(images));
// icon.png (256px, for electron-builder + BrowserWindow icon fallback)
writeFileSync(path.join(outDir, 'icon.png'), toPNG(renderMark(256), 256));
// 512px marketing png
writeFileSync(path.join(outDir, 'icon@512.png'), toPNG(renderMark(512), 512));

console.log('icons written:', sizes.join(', '), '+ icon.png + icon@512.png →', outDir);
