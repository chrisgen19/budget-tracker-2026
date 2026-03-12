import sharp from "sharp";
import path from "path";

const PUBLIC_DIR = path.resolve(__dirname, "../public");

// Wallet icon SVG path from Lucide (same as src/app/icon.tsx)
const WALLET_SVG_PATH = `
  <path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1" />
  <path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4" />
`;

function createSvg(size: number, iconScale: number, borderRadius: number): string {
  const iconSize = Math.round(size * iconScale);
  const offset = Math.round((size - iconSize) / 2);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <rect width="${size}" height="${size}" rx="${borderRadius}" fill="#C8702A" />
    <svg x="${offset}" y="${offset}" width="${iconSize}" height="${iconSize}" viewBox="0 0 24 24"
      fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      ${WALLET_SVG_PATH}
    </svg>
  </svg>`;
}

interface IconConfig {
  name: string;
  size: number;
  iconScale: number;
  borderRadius: number;
}

const icons: IconConfig[] = [
  // Standard PWA icons (rounded corners)
  { name: "icon-192x192.png", size: 192, iconScale: 0.55, borderRadius: 32 },
  { name: "icon-512x512.png", size: 512, iconScale: 0.55, borderRadius: 80 },
  // Maskable icons (no rounded corners, icon in safe zone ~60% for padding)
  { name: "icon-maskable-192x192.png", size: 192, iconScale: 0.45, borderRadius: 0 },
  { name: "icon-maskable-512x512.png", size: 512, iconScale: 0.45, borderRadius: 0 },
  // Apple touch icon
  { name: "apple-touch-icon.png", size: 180, iconScale: 0.55, borderRadius: 0 },
];

async function generate() {
  for (const icon of icons) {
    const svg = createSvg(icon.size, icon.iconScale, icon.borderRadius);
    await sharp(Buffer.from(svg)).png().toFile(path.join(PUBLIC_DIR, icon.name));
    console.log(`Generated ${icon.name}`);
  }
  console.log("Done!");
}

generate();
