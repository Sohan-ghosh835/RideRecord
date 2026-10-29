/**
 * Generate PNG PWA icons from the RideRecord logo PNG using sharp.
 * Run: node scripts/generate-png-icons.cjs
 */
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const publicDir = path.join(__dirname, '..', 'public');
const logoPath = path.join(__dirname, '..', '..', 'RideRecord Motorcycle Log Logo.png');

async function generateIcon(size, padding, outputName) {
  const innerSize = Math.round(size - padding * 2);
  const roundedCorners = Math.round(size * 0.18);

  // Create a rounded-rect background
  const bgSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
    <rect width="${size}" height="${size}" rx="${roundedCorners}" fill="#0d0d0d"/>
  </svg>`;

  // Resize the logo to fit inside the padded area
  const resizedLogo = await sharp(logoPath)
    .resize(innerSize, innerSize, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .negate({ alpha: false }) // Invert black logo to white for dark background
    .png()
    .toBuffer();

  // Composite logo on top of background
  await sharp(Buffer.from(bgSvg))
    .resize(size, size)
    .composite([{
      input: resizedLogo,
      top: padding,
      left: padding,
    }])
    .png()
    .toFile(path.join(publicDir, outputName));

  console.log(`Generated ${outputName}`);
}

async function generateMaskableIcon(size, outputName) {
  const padding = Math.round(size * 0.15);
  const innerSize = Math.round(size - padding * 2);

  // Maskable icons: full-bleed rectangle background (no rounded corners)
  const bgSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
    <rect width="${size}" height="${size}" fill="#0d0d0d"/>
  </svg>`;

  const resizedLogo = await sharp(logoPath)
    .resize(innerSize, innerSize, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .negate({ alpha: false })
    .png()
    .toBuffer();

  await sharp(Buffer.from(bgSvg))
    .resize(size, size)
    .composite([{
      input: resizedLogo,
      top: padding,
      left: padding,
    }])
    .png()
    .toFile(path.join(publicDir, outputName));

  console.log(`Generated ${outputName}`);
}

async function generate() {
  // Verify logo file exists
  if (!fs.existsSync(logoPath)) {
    console.error(`Logo not found at: ${logoPath}`);
    process.exit(1);
  }

  const sizes = [192, 512];
  for (const size of sizes) {
    const padding = Math.round(size * 0.12);
    await generateIcon(size, padding, `icon-${size}.png`);
    await generateMaskableIcon(size, `icon-maskable-${size}.png`);
  }

  // Also generate apple-touch-icon (180x180)
  const applePadding = Math.round(180 * 0.08);
  await generateIcon(180, applePadding, 'apple-touch-icon.png');

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
