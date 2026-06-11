// Builds the release ZIP a non-technical user downloads from GitHub Releases.
//
// Output: dist/whisky-auction-landed-cost-v<version>.zip
// The zip unpacks to ONE folder (whisky-auction-landed-cost/) containing only
// the runtime files Chrome needs (manifest, src, icons) plus INSTALL.txt with
// plain-English load-unpacked steps. Tests/previews/tooling stay out.
//
// Run: node tools/package.mjs
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(join(repoRoot, 'manifest.json'), 'utf8'));
const version = manifest.version;
const name = 'whisky-auction-landed-cost';

const dist = join(repoRoot, 'dist');
const stage = join(dist, name); // single top-level folder inside the zip
const zipPath = join(dist, `${name}-v${version}.zip`);

rmSync(dist, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });

// Runtime files only.
cpSync(join(repoRoot, 'manifest.json'), join(stage, 'manifest.json'));
cpSync(join(repoRoot, 'src'), join(stage, 'src'), { recursive: true });
cpSync(join(repoRoot, 'icons'), join(stage, 'icons'), { recursive: true });

writeFileSync(join(stage, 'INSTALL.txt'), `Whisky Auction Landed-Cost Calculator (AU) — v${version}

HOW TO INSTALL (about 1 minute, no technical knowledge needed)

1. If you downloaded this as a .zip, double-click it to unzip.
   You should now have a folder called "${name}".
2. Open Google Chrome.
3. In the address bar, type:  chrome://extensions  and press Enter.
4. In the top-right corner, turn ON the "Developer mode" switch.
5. Click the "Load unpacked" button (top-left).
6. Select the "${name}" folder from step 1 and click Open/Select.

Done! Now open a lot page on whiskyauctioneer.com or
australianwhiskyauctions.com.au — a small "Landed cost" panel appears in the
bottom-right corner showing the estimated all-in cost in Australian dollars.

Tips
- Drag the panel by its dark header to move it; the "—" button collapses it.
- Every number it reads from the page can be edited if it gets one wrong.
- "Rates & fees" (bottom of the panel) lets you adjust premiums, insurance,
  shipping and tax rates. Your changes are remembered.
- Keep the folder where it is — if you delete or move it, Chrome will ask you
  to load the extension again.

All figures are estimates only; duty and tax rates change over time.
`);

// Zip with the folder as the top-level entry so unzipping is tidy.
execFileSync('zip', ['-r', '-q', zipPath, name], { cwd: dist });
rmSync(stage, { recursive: true, force: true });

// Release notes used as the GitHub Release body.
writeFileSync(join(dist, 'RELEASE_NOTES.md'), `Estimates the **AUD landed cost** of whisky auction lots for an Australian buyer — directly on the listing page.

**Supported sites:** whiskyauctioneer.com (import cost across Direct / via-UK / via-EU carry routes, cheapest highlighted) · australianwhiskyauctions.com.au (domestic delivered cost).

## How to install (no technical knowledge needed)

1. Download **\`${name}-v${version}.zip\`** below and double-click it to unzip — you'll get a folder called \`${name}\`.
2. In Chrome, go to \`chrome://extensions\`.
3. Turn on **Developer mode** (switch in the top-right corner).
4. Click **Load unpacked** and select the \`${name}\` folder.
5. Open any lot page on a supported site — the 🥃 panel appears bottom-right.

Full instructions are also in \`INSTALL.txt\` inside the zip. Keep the folder where it is after installing.

> Estimates only — duty, excise and FX rates change. See the README for the full methodology.
`);

console.log('built ' + zipPath);
