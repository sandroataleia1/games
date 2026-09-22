import { writeFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const { ImageResponse } = require("next/og");

const outDir = new URL("../apps/web/public/icons/", import.meta.url);
await mkdir(outDir, { recursive: true });

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
        background: "#12101d",
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
              children: "Q",
            },
          },
        },
      },
    },
  };
}

async function render(node, size, file) {
  const response = new ImageResponse(node, { width: size, height: size });
  const buffer = Buffer.from(await response.arrayBuffer());
  await writeFile(new URL(file, outDir), buffer);
  console.log("wrote", file, buffer.length, "bytes");
}

await render(mark(192, { safe: 0.82 }), 192, "icon-192.png");
await render(mark(512, { safe: 0.82 }), 512, "icon-512.png");
await render(mark(512, { safe: 0.62, radius: "0" }), 512, "icon-maskable-512.png");
await render(mark(180, { safe: 0.82 }), 180, "apple-touch-icon.png");
