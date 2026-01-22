/**
 * Icon Generation Script for Widget Wall Desktop
 * Converts the widget.svg to all required icon formats for Tauri
 *
 * Usage: node scripts/generate-icons.js
 */

import sharp from 'sharp';
import pngToIco from 'png-to-ico';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..');

const SVG_PATH = join(projectRoot, 'src', 'assets', 'widget.svg');
const ICONS_DIR = join(projectRoot, 'src-tauri', 'icons');

// Icon sizes required by Tauri
const ICON_SIZES = [
  { name: '32x32.png', size: 32 },
  { name: '128x128.png', size: 128 },
  { name: '128x128@2x.png', size: 256 },  // 2x is 256px
];

// Sizes for ICO file (Windows) - multiple sizes in one file
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];

async function generateIcons() {
  console.log('Generating icons from widget.svg...\n');

  // Ensure icons directory exists
  if (!existsSync(ICONS_DIR)) {
    mkdirSync(ICONS_DIR, { recursive: true });
  }

  // Read SVG
  const svgBuffer = readFileSync(SVG_PATH);
  console.log(`Read SVG from: ${SVG_PATH}`);

  // Generate PNG icons
  for (const icon of ICON_SIZES) {
    const outputPath = join(ICONS_DIR, icon.name);
    await sharp(svgBuffer)
      .resize(icon.size, icon.size)
      .png()
      .toFile(outputPath);
    console.log(`  Generated: ${icon.name} (${icon.size}x${icon.size})`);
  }

  // Generate temporary PNGs for ICO
  console.log('\nGenerating ICO file...');
  const icoBuffers = [];
  for (const size of ICO_SIZES) {
    const buffer = await sharp(svgBuffer)
      .resize(size, size)
      .png()
      .toBuffer();
    icoBuffers.push(buffer);
  }

  // Create ICO file
  const icoBuffer = await pngToIco(icoBuffers);
  const icoPath = join(ICONS_DIR, 'icon.ico');
  writeFileSync(icoPath, icoBuffer);
  console.log(`  Generated: icon.ico (${ICO_SIZES.join(', ')}px)`);

  // Note about macOS icon
  console.log('\n[NOTE] icon.icns (macOS) not generated - requires macOS tools.');
  console.log('       For macOS builds, use: iconutil on macOS or remove from tauri.conf.json\n');

  console.log('Icon generation complete!');
}

generateIcons().catch(console.error);
