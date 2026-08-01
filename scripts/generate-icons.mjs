#!/usr/bin/env node
/**
 * Renders the application icon from its single SVG source.
 *
 * WHY THE PNGS ARE COMMITTED RATHER THAN BUILT
 *
 * Rasterising needs a rendering engine. The only one this repository has is the
 * browser Playwright drives for the tests, and making a browser download a
 * prerequisite of `pnpm run build` would put a two-hundred-megabyte install
 * between a contributor and their first build of a static site. The images
 * change roughly never. So they are generated here, by hand, and committed --
 * with this script kept beside them so that "how was this made" has an answer
 * that is not "somebody's image editor, once".
 *
 * WHY PNG AT ALL
 *
 * An SVG icon is enough for a manifest on current Chromium and is declared
 * alongside these. It is not enough anywhere else: iOS reads `apple-touch-icon`
 * and wants a raster, and several launchers still rasterise ahead of time from a
 * fixed size list. The manifest therefore offers both, and the PNGs are what
 * makes the install look right on a phone -- which, for this project, is the
 * case that matters most.
 *
 * USAGE
 *
 *   node scripts/generate-icons.mjs
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';

const SOURCE = fileURLToPath(new URL('../apps/web/icons/icon.svg', import.meta.url));
const OUTPUT_DIRECTORY = fileURLToPath(new URL('../apps/web/public/icons/', import.meta.url));

/**
 * The sizes, and who asks for each.
 *
 * 192 and 512 are what the manifest specification's own examples use and what
 * installability checks look for. 180 is the one Apple reads; it ignores the
 * manifest entirely and takes `apple-touch-icon` from the markup, so leaving it
 * out gives an installed iOS shortcut a screenshot of the page instead of an
 * icon -- the single most visible way a PWA looks unfinished.
 */
const SIZES = [
  { size: 192, name: 'icon-192.png' },
  { size: 512, name: 'icon-512.png' },
  { size: 180, name: 'apple-touch-icon.png' },
];

async function main() {
  const svg = await readFile(SOURCE, 'utf8');
  await mkdir(OUTPUT_DIRECTORY, { recursive: true });
  // Also copied to the served directory, because the manifest offers the vector
  // to anything that can use it. The copy is written from the same read, so the
  // two cannot drift.
  await writeFile(new URL('icon.svg', `file://${OUTPUT_DIRECTORY}`), svg);

  const browser = await chromium.launch();
  try {
    for (const { size, name } of SIZES) {
      // A fresh context per size: the viewport is the frame being captured, and
      // `deviceScaleFactor: 1` keeps a retina development machine from silently
      // producing images at twice the size they claim.
      const context = await browser.newContext({
        viewport: { width: size, height: size },
        deviceScaleFactor: 1,
      });
      const page = await context.newPage();
      // The SVG is inlined rather than linked so that nothing is fetched and the
      // render cannot half-complete. `image-rendering` is left alone: the source
      // is vector, so the engine is scaling geometry rather than pixels.
      await page.setContent(
        `<!doctype html><meta charset="utf-8">` +
          `<style>html,body{margin:0;padding:0;width:${String(size)}px;height:${String(size)}px}` +
          `svg{display:block;width:100%;height:100%}</style>` +
          svg,
      );
      const png = await page.screenshot({ omitBackground: false, type: 'png' });
      const file = fileURLToPath(new URL(name, `file://${OUTPUT_DIRECTORY}`));
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, png);
      console.log(`${name}: ${String(size)}x${String(size)}, ${String(png.byteLength)} bytes`);
      await context.close();
    }
  } finally {
    await browser.close();
  }
}

await main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
