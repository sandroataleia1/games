import { writeFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const { ImageResponse } = require("next/og");

const iconsDir = new URL("../apps/web/public/icons/", import.meta.url);
const appDir = new URL("../apps/web/src/app/", import.meta.url);
await mkdir(iconsDir, { recursive: true });

function mark(size, { safe = 1, radius = "34% 66% 62% 38% / 46% 40% 60% 54%" } = {}) {
  const blob = Math.round(size * safe);
  return {
    type: "div",
    props: {
      style: {
        width: size,
        height: size,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#100c1c",
      },
      children: {
        type: "div",
        props: {
          style: {
            width: blob,
            height: blob,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: radius,
            background: "linear-gradient(135deg, #c5f16b, #4de3ff)",
          },
          children: {
            type: "span",
            props: {
              style: {
                fontSize: Math.round(blob * 0.56),
                fontWeight: 800,
                color: "#16221a",
                fontFamily: "sans-serif",
              },
              children: "M",
            },
          },
        },
      },
    },
  };
}

async function renderPng(node, size) {
  const response = new ImageResponse(node, { width: size, height: size });
  return Buffer.from(await response.arrayBuffer());
}

async function render(node, size, file) {
  const buffer = await renderPng(node, size);
  await writeFile(new URL(file, iconsDir), buffer);
  console.log("wrote", file, buffer.length, "bytes");
  return buffer;
}

// Minimal ICO container wrapping PNG-format frames (supported by every
// browser and by Windows since Vista) - avoids pulling in an image codec
// just to produce a multi-resolution favicon.
function packIco(frames) {
  const headerSize = 6;
  const dirEntrySize = 16;
  const header = Buffer.alloc(headerSize);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(frames.length, 4);

  const dir = Buffer.alloc(dirEntrySize * frames.length);
  let offset = headerSize + dirEntrySize * frames.length;
  frames.forEach(({ size, buffer }, index) => {
    const entry = dir.subarray(index * dirEntrySize, (index + 1) * dirEntrySize);
    entry.writeUInt8(size >= 256 ? 0 : size, 0);
    entry.writeUInt8(size >= 256 ? 0 : size, 1);
    entry.writeUInt8(0, 2);
    entry.writeUInt8(0, 3);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(buffer.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += buffer.length;
  });

  return Buffer.concat([header, dir, ...frames.map((frame) => frame.buffer)]);
}

await render(mark(192, { safe: 0.82 }), 192, "icon-192.png");
await render(mark(512, { safe: 0.82 }), 512, "icon-512.png");
await render(mark(512, { safe: 0.62, radius: "0" }), 512, "icon-maskable-512.png");
await render(mark(180, { safe: 0.82 }), 180, "apple-touch-icon.png");

const favicon16 = await renderPng(mark(16, { safe: 0.82 }), 16);
const favicon32 = await renderPng(mark(32, { safe: 0.82 }), 32);
const favicon = packIco([{ size: 16, buffer: favicon16 }, { size: 32, buffer: favicon32 }]);
await writeFile(new URL("favicon.ico", appDir), favicon);
console.log("wrote favicon.ico", favicon.length, "bytes");
