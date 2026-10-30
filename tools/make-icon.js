// Generates assets/icon.png and assets/icon.ico (a purple notebook with rings and ruled lines).
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const S = 256;
const px = Buffer.alloc(S * S * 4);

function blend(x, y, [r, g, b], a) {
  if (x < 0 || y < 0 || x >= S || y >= S || a <= 0) return;
  const i = (y * S + x) * 4;
  const da = px[i + 3] / 255;
  const oa = a + da * (1 - a);
  px[i] = Math.round((r * a + px[i] * da * (1 - a)) / oa);
  px[i + 1] = Math.round((g * a + px[i + 1] * da * (1 - a)) / oa);
  px[i + 2] = Math.round((b * a + px[i + 2] * da * (1 - a)) / oa);
  px[i + 3] = Math.round(oa * 255);
}

// Anti-aliased rounded rectangle via signed distance, 4x4 supersampling.
function roundRect(x0, y0, x1, y1, rad, color, alpha = 1) {
  for (let y = Math.floor(y0); y < Math.ceil(y1); y++)
    for (let x = Math.floor(x0); x < Math.ceil(x1); x++) {
      let cover = 0;
      for (let sy = 0; sy < 4; sy++)
        for (let sx = 0; sx < 4; sx++) {
          const px_ = x + (sx + 0.5) / 4;
          const py_ = y + (sy + 0.5) / 4;
          const cx = Math.max(x0 + rad, Math.min(px_, x1 - rad));
          const cy = Math.max(y0 + rad, Math.min(py_, y1 - rad));
          if ((px_ - cx) ** 2 + (py_ - cy) ** 2 <= rad * rad && px_ >= x0 && px_ <= x1 && py_ >= y0 && py_ <= y1) cover++;
        }
      blend(x, y, color, (cover / 16) * alpha);
    }
}

const purple = [107, 63, 160];
const dark = [74, 40, 118];
const white = [255, 255, 255];
const paper = [246, 242, 252];
const line = [190, 172, 220];

roundRect(28, 16, 236, 244, 30, dark); // back cover
roundRect(20, 12, 226, 238, 28, purple); // front cover
roundRect(64, 40, 206, 210, 12, paper); // page
for (let y = 82; y <= 182; y += 25) roundRect(84, y, 188, y + 6, 3, line);
roundRect(84, 58, 160, 66, 4, purple, 0.8); // title line
for (const y of [52, 100, 148, 196]) {
  roundRect(32, y - 9, 76, y + 9, 9, white); // rings
  roundRect(38, y - 4, 70, y + 4, 4, dark, 0.35);
}

function png(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const pngBuf = png(S, S, px);
// ICO with a single embedded 256x256 PNG (supported since Windows Vista).
const header = Buffer.from([0, 0, 1, 0, 1, 0]);
const entry = Buffer.alloc(16);
entry.set([0, 0, 0, 0], 0);
entry.writeUInt16LE(1, 4);
entry.writeUInt16LE(32, 6);
entry.writeUInt32LE(pngBuf.length, 8);
entry.writeUInt32LE(22, 12);

const out = path.join(__dirname, '..', 'assets');
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'icon.png'), pngBuf);
fs.writeFileSync(path.join(out, 'icon.ico'), Buffer.concat([header, entry, pngBuf]));
console.log('icons written to', out);
