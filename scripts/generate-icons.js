#!/usr/bin/env node

/**
 * Generate PWA icons as simple SVG files.
 * For production, replace with proper PNG icons.
 */

const fs = require('fs');
const path = require('path');

const sizes = [72, 96, 128, 144, 152, 192, 384, 512];
const iconsDir = path.join(__dirname, '..', 'public', 'icons');

if (!fs.existsSync(iconsDir)) {
  fs.mkdirSync(iconsDir, { recursive: true });
}

for (const size of sizes) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${size * 0.15}" fill="#6366f1"/>
  <text x="50%" y="55%" dominant-baseline="middle" text-anchor="middle" font-family="system-ui, sans-serif" font-size="${size * 0.35}" font-weight="bold" fill="white">H</text>
  <circle cx="${size * 0.7}" cy="${size * 0.3}" r="${size * 0.1}" fill="#22c55e" opacity="0.9"/>
</svg>`;

  // Write SVG (browsers support SVG icons)
  fs.writeFileSync(path.join(iconsDir, `icon-${size}x${size}.svg`), svg);

  // Also create a simple placeholder PNG path reference
  // In production, use a proper image generation tool
  console.log(`Generated icon-${size}x${size}.svg`);
}

// Create favicon as SVG
const faviconSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
  <rect width="32" height="32" rx="6" fill="#6366f1"/>
  <text x="50%" y="55%" dominant-baseline="middle" text-anchor="middle" font-family="system-ui, sans-serif" font-size="18" font-weight="bold" fill="white">H</text>
</svg>`;

fs.writeFileSync(path.join(__dirname, '..', 'public', 'favicon.svg'), faviconSvg);
console.log('Generated favicon.svg');
console.log('\\nNote: For production, convert SVG icons to PNG using a tool like sharp or ImageMagick.');
