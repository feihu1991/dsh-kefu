import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = (crc ^ buf[i]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, "ascii");
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function png(size) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const i = y * (size * 4 + 1) + 1 + x * 4;
      const t = (x + y) / (2 * size);
      raw[i] = Math.round(30 + 47 * t);      // R 渐变
      raw[i + 1] = Math.round(60 + 87 * t);  // G
      raw[i + 2] = Math.round(120 + 130 * t);// B
      raw[i + 3] = 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const dir = new URL("./src-tauri/icons/", import.meta.url);
mkdirSync(dir, { recursive: true });
writeFileSync(new URL("./public-icon.png", import.meta.url), png(512));
writeFileSync(new URL("./src-tauri/icons/32x32.png", import.meta.url), png(32));
writeFileSync(new URL("./src-tauri/icons/128x128.png", import.meta.url), png(128));
writeFileSync(new URL("./src-tauri/icons/128x128@2x.png", import.meta.url), png(256));
writeFileSync(new URL("./src-tauri/icons/icon.png", import.meta.url), png(512));
console.log("icons generated (512 source at client/public-icon.png)");
