/**
 * Generate PWA icon PNGs from the favicon SVG.
 * Uses a simple approach: wraps the SVG in an HTML canvas rendering via a data URL.
 * Since we can't use canvas in pure Node without native deps, we generate
 * SVG-based icons that browsers can use directly, plus we create proper
 * self-contained SVG icons with embedded backgrounds for maskable variants.
 */
const fs = require('fs');
const path = require('path');

const publicDir = path.join(__dirname, '..', 'public');
const svgSource = fs.readFileSync(path.join(publicDir, 'favicon.svg'), 'utf8');

// For regular icons: the lightning bolt SVG on a dark rounded-rect background
function makeIcon(size) {
  // Scale the original 48x46 SVG to fit within the icon with padding
  const padding = Math.round(size * 0.15);
  const innerSize = size - padding * 2;
  const scaleX = innerSize / 48;
  const scaleY = innerSize / 46;
  const scale = Math.min(scaleX, scaleY);
  const w = 48 * scale;
  const h = 46 * scale;
  const offsetX = (size - w) / 2;
  const offsetY = (size - h) / 2;
  
  // Extract the SVG content (paths, masks, filters etc) from the source
  const innerContent = svgSource
    .replace(/<svg[^>]*>/, '')
    .replace(/<\/svg>/, '');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${Math.round(size * 0.18)}" fill="#0d0d0d"/>
  <g transform="translate(${offsetX.toFixed(2)},${offsetY.toFixed(2)}) scale(${scale.toFixed(4)})">
    ${innerContent}
  </g>
</svg>`;
}

// For maskable icons: full-bleed with safe zone (icon content in the center 80%)
function makeMaskableIcon(size) {
  const safeZone = size * 0.1; // 10% padding on each side = 80% safe area
  const innerSize = size - safeZone * 2;
  const scaleX = innerSize / 48;
  const scaleY = innerSize / 46;
  const scale = Math.min(scaleX, scaleY);
  const w = 48 * scale;
  const h = 46 * scale;
  const offsetX = (size - w) / 2;
  const offsetY = (size - h) / 2;
  
  const innerContent = svgSource
    .replace(/<svg[^>]*>/, '')
    .replace(/<\/svg>/, '');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="#0d0d0d"/>
  <g transform="translate(${offsetX.toFixed(2)},${offsetY.toFixed(2)}) scale(${scale.toFixed(4)})">
    ${innerContent}
  </g>
</svg>`;
}

// Write SVG icons (browsers accept SVG for PWA icons in most cases, 
// but for maximum compatibility we'll also describe a PNG generation approach)
const sizes = [192, 512];
for (const size of sizes) {
  fs.writeFileSync(path.join(publicDir, `icon-${size}.svg`), makeIcon(size));
  fs.writeFileSync(path.join(publicDir, `icon-maskable-${size}.svg`), makeMaskableIcon(size));
  console.log(`Generated icon-${size}.svg and icon-maskable-${size}.svg`);
}

console.log('Done. Note: For PNG icons, install sharp or use an online converter.');
console.log('Updating manifest to use SVG icons as fallback...');

// Update manifest to reference SVG icons since we can't generate PNGs without native deps
const manifestPath = path.join(publicDir, 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
manifest.icons = [
  { src: './icon-192.svg', sizes: '192x192', type: 'image/svg+xml', purpose: 'any' },
  { src: './icon-512.svg', sizes: '512x512', type: 'image/svg+xml', purpose: 'any' },
  { src: './icon-maskable-192.svg', sizes: '192x192', type: 'image/svg+xml', purpose: 'maskable' },
  { src: './icon-maskable-512.svg', sizes: '512x512', type: 'image/svg+xml', purpose: 'maskable' },
  { src: './favicon.svg', sizes: 'any', type: 'image/svg+xml' }
];
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
console.log('Manifest updated.');
