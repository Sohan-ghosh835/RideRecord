/**
 * Generate PNG PWA icons from the favicon SVG using sharp.
 * Run: node scripts/generate-png-icons.cjs
 */
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const publicDir = path.join(__dirname, '..', 'public');
const svgSource = fs.readFileSync(path.join(publicDir, 'favicon.svg'), 'utf8');

function wrapSvg(size, padding) {
  const innerSize = size - padding * 2;
  const scaleX = innerSize / 48;
  const scaleY = innerSize / 46;
  const scale = Math.min(scaleX, scaleY);
  const w = 48 * scale;
  const h = 46 * scale;
  const offsetX = (size - w) / 2;
  const offsetY = (size - h) / 2;
  const innerContent = svgSource.replace(/<svg[^>]*>/, '').replace(/<\/svg>/, '');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${Math.round(size * 0.18)}" fill="#0d0d0d"/>
  <g transform="translate(${offsetX.toFixed(2)},${offsetY.toFixed(2)}) scale(${scale.toFixed(4)})">
    ${innerContent}
  </g>
</svg>`;
}

function wrapMaskable(size) {
  const padding = size * 0.15;
  const innerSize = size - padding * 2;
  const scaleX = innerSize / 48;
  const scaleY = innerSize / 46;
  const scale = Math.min(scaleX, scaleY);
  const w = 48 * scale;
  const h = 46 * scale;
  const offsetX = (size - w) / 2;
  const offsetY = (size - h) / 2;
  const innerContent = svgSource.replace(/<svg[^>]*>/, '').replace(/<\/svg>/, '');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="#0d0d0d"/>
  <g transform="translate(${offsetX.toFixed(2)},${offsetY.toFixed(2)}) scale(${scale.toFixed(4)})">
    ${innerContent}
  </g>
</svg>`;
}

async function generate() {
  const sizes = [192, 512];
  for (const size of sizes) {
    const regularSvg = Buffer.from(wrapSvg(size, Math.round(size * 0.12)));
    const maskableSvg = Buffer.from(wrapMaskable(size));
    
    await sharp(regularSvg, { density: 150 })
      .resize(size, size)
      .png()
      .toFile(path.join(publicDir, `icon-${size}.png`));
    console.log(`Generated icon-${size}.png`);
    
    await sharp(maskableSvg, { density: 150 })
      .resize(size, size)
      .png()
      .toFile(path.join(publicDir, `icon-maskable-${size}.png`));
    console.log(`Generated icon-maskable-${size}.png`);
  }
  
  // Also generate apple-touch-icon (180x180)
  const appleSvg = Buffer.from(wrapSvg(180, Math.round(180 * 0.08)));
  await sharp(appleSvg, { density: 150 })
    .resize(180, 180)
    .png()
    .toFile(path.join(publicDir, 'apple-touch-icon.png'));
  console.log('Generated apple-touch-icon.png');

  // Update manifest to use PNG icons
  const manifestPath = path.join(publicDir, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  manifest.icons = [
    { src: './icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: './icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: './icon-maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
    { src: './icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ];
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  console.log('Manifest updated with PNG icon references.');
}

generate().catch(err => { console.error(err); process.exit(1); });
