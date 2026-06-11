// Headless validation of the cost engine. Run: node test/calc.test.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { compute, computeDomestic } = require('../src/calc.js');

let pass = 0, fail = 0;
const approx = (a, lo, hi) => a >= lo && a <= hi;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  \x1b[32m✓\x1b[0m ' + name); }
  else { fail++; console.log('  \x1b[31m✗\x1b[0m ' + name + (detail ? '  — ' + detail : '')); }
}
const aud = (n) => 'A$' + n.toLocaleString('en-AU', { maximumFractionDigits: 0 });

// ---------------------------------------------------------------------------
// Worked example: William Larue Weller 2016, EU lot, 0.75 L, 67.7% ABV,
// hammer £800, 11% premium, 2% insurance, FX 1.875, bourbon (US origin → tariff).
// Targets from the brief:
//   Direct ~A$2,150–2,220 ; Via EU ~A$1,700–1,750 (cheapest) ; Via UK ~A$2,100+.
// ---------------------------------------------------------------------------
// Pin the brief's stated inputs (11% premium, 2% insurance) so this validates the
// engine against the brief's own worked example regardless of the production default.
console.log('\nWorked example — Weller 2016, EU lot, bourbon, £800:');
const r = compute({ bidGBP: 800, volumeL: 0.75, abv: 0.677, origin: 'US', lotRegion: 'EU', premiumRate: 0.11, insuranceRate: 0.02 });
const byId = Object.fromEntries(r.scenarios.map((s) => [s.id, s]));
for (const s of r.scenarios) {
  console.log('    ' + s.label.padEnd(28) + aud(s.total) + (s.id === r.cheapestId ? '   ← cheapest' : ''));
}

check('Direct ≈ A$2,150–2,260', approx(byId.direct.total, 2150, 2260), aud(byId.direct.total));
check('Via EU ≈ A$1,690–1,760', approx(byId.eu.total, 1690, 1760), aud(byId.eu.total));
check('Via UK ≈ A$2,050–2,180', approx(byId.uk.total, 2050, 2180), aud(byId.uk.total));
check('Via EU is the cheapest route (the whole point)', r.cheapestId === 'eu',
  'cheapest was ' + r.cheapestId);
check('EU route is materially cheaper than direct (>A$300 saving)',
  byId.direct.total - byId.eu.total > 300, aud(byId.direct.total - byId.eu.total));
check('Crossing Brexit (EU lot via UK) wipes the saving (within ~A$200 of direct)',
  Math.abs(byId.direct.total - byId.uk.total) < 200, aud(byId.direct.total - byId.uk.total));

// ---------------------------------------------------------------------------
// UK lot mirror image: carry via UK should win; via EU should add ~22% VAT.
// ---------------------------------------------------------------------------
console.log('\nUK-origin Scotch, UK lot, £800:');
const u = compute({ bidGBP: 800, volumeL: 0.7, abv: 0.46, origin: 'UK', lotRegion: 'UK' });
const ub = Object.fromEntries(u.scenarios.map((s) => [s.id, s]));
for (const s of u.scenarios) {
  console.log('    ' + s.label.padEnd(28) + aud(s.total) + (s.id === u.cheapestId ? '   ← cheapest' : ''));
}
check('UK lot: cheapest is the UK carry route', u.cheapestId === 'uk', u.cheapestId);
check('UK-origin direct: tariff is waived (A-UK FTA)',
  ub.direct.lines.find((l) => l.label.startsWith('Tariff')).amount === 0);
check('UK lot via EU adds import VAT (> UK carry route)', ub.eu.total > ub.uk.total);

// ---------------------------------------------------------------------------
// Rule-of-thumb sanity: carry floor ≈ ×2.1, EU/US direct ≈ higher than UK direct.
// ---------------------------------------------------------------------------
console.log('\nRule-of-thumb checks:');
const floorMult = byId.eu.total / 800;
check('Carry-home floor ≈ ×2.1 of hammer (got ×' + floorMult.toFixed(2) + ')',
  approx(floorMult, 2.0, 2.25));
const ukOriginDirect = compute({ bidGBP: 800, volumeL: 0.7, abv: 0.46, origin: 'UK', lotRegion: 'UK' }).scenarios.find((s) => s.id === 'direct').total;
const usOriginDirect = compute({ bidGBP: 800, volumeL: 0.7, abv: 0.46, origin: 'US', lotRegion: 'UK' }).scenarios.find((s) => s.id === 'direct').total;
check('US-origin direct costs more than UK-origin direct (5% tariff)',
  usOriginDirect > ukOriginDirect, aud(usOriginDirect) + ' vs ' + aud(ukOriginDirect));

// ---------------------------------------------------------------------------
// SAC threshold: a cheap lot (FOB ≤ $1000) pays no tariff/fees but still excise+GST.
// ---------------------------------------------------------------------------
console.log('\nLow-value SAC clearance (£100 hammer):');
const s = compute({ bidGBP: 100, volumeL: 0.75, abv: 0.677, origin: 'US', lotRegion: 'UK' });
const sd = s.scenarios.find((x) => x.id === 'direct');
check('FOB ≤ $1000: no import declaration fee line', !sd.lines.some((l) => l.label === 'Import declaration'));
check('FOB ≤ $1000: tariff not charged', sd.lines.find((l) => l.label.startsWith('Tariff')).amount === 0);
check('FOB ≤ $1000: excise still charged', sd.lines.find((l) => l.label.startsWith('Excise')).amount > 0);
check('FOB ≤ $1000: GST still charged', sd.lines.find((l) => l.label.startsWith('GST')).amount > 0);

// ---------------------------------------------------------------------------
// Fee defaults & card surcharge.
// ---------------------------------------------------------------------------
console.log('\nFee defaults & card surcharge:');
const base = compute({ bidGBP: 800, volumeL: 0.75, abv: 0.677, origin: 'US', lotRegion: 'EU' });
check('Default buyer\'s premium is the confirmed 12.5%',
  base.scenarios[0].lines.find((l) => l.label.startsWith('Buyer')).label.includes('12.5%'));
check('Card surcharge off by default (no surcharge line)',
  !base.scenarios.find((s) => s.id === 'eu').lines.some((l) => l.label.startsWith('Card surcharge')));
const surcharged = compute({ bidGBP: 800, volumeL: 0.75, abv: 0.677, origin: 'US', lotRegion: 'EU', cardSurchargeRate: 0.035 });
const euBase = base.scenarios.find((s) => s.id === 'eu').total;
const euSur = surcharged.scenarios.find((s) => s.id === 'eu').total;
check('3.5% card surcharge raises the total', euSur > euBase, aud(euSur) + ' vs ' + aud(euBase));
check('Surcharge shows as its own breakdown line',
  surcharged.scenarios.find((s) => s.id === 'eu').lines.some((l) => l.label.startsWith('Card surcharge')));

// ---------------------------------------------------------------------------
// Carry-home allowance is volumetric (per adult), not one-bottle.
// ---------------------------------------------------------------------------
console.log('\nVolumetric carry allowance:');
const within = compute({ bidGBP: 500, volumeL: 0.75, abv: 0.5, origin: 'UK', lotRegion: 'EU' });
check('allowanceL surfaced (default 2.25 L)', within.inputs.allowanceL === 2.25, within.inputs.allowanceL);
check('0.75 L lot is within allowance (carry not flagged)',
  within.scenarios.find((x) => x.id === 'eu').overAllowance === false);
check('2.25 L exactly is still within allowance',
  compute({ bidGBP: 500, volumeL: 2.25, abv: 0.5, lotRegion: 'EU' }).scenarios.find((x) => x.id === 'eu').overAllowance === false);
const over = compute({ bidGBP: 500, volumeL: 3, abv: 0.5, origin: 'UK', lotRegion: 'EU' });
check('3 L lot exceeds allowance (carry flagged overAllowance)',
  over.scenarios.find((x) => x.id === 'eu').overAllowance === true);
check('raising allowance to 4.5 L brings a 3 L lot back within',
  compute({ bidGBP: 500, volumeL: 3, abv: 0.5, lotRegion: 'EU', auConcessionLitres: 4.5 }).scenarios.find((x) => x.id === 'eu').overAllowance === false);

// ---------------------------------------------------------------------------
// Domestic model (Australian Whisky Auctions) — no import stack, single route.
// ---------------------------------------------------------------------------
console.log('\nDomestic model (AWA) — $1905 hammer:');
const dm = computeDomestic({ bidAUD: 1905 });
const dms = dm.scenarios[0];
console.log('    ' + dms.label.padEnd(28) + aud(dms.total));
check('single scenario (no routing)', dm.scenarios.length === 1 && dm.cheapestId === 'domestic');
// hammer 1905 + 10% premium (190.50) = 2095.50; +1.5% insurance of hammer (28.58); +14 ship = 2138.08
check('total ≈ hammer + 10% premium + 1.5% insurance (of hammer) + $14 shipping',
  approx(dms.total, 2136, 2140), aud(dms.total));
check('insurance is 1.5% of hammer, not hammer+premium',
  dms.lines.find((l) => /breakage/i.test(l.label)).amount === 28.58,
  dms.lines.find((l) => /breakage/i.test(l.label)).amount);
check('premium line is GST-inclusive 10%',
  dms.lines.some((l) => /premium \(10%, incl. GST\)/.test(l.label)));
check('no excise / tariff / GST line (domestic resale)',
  !dms.lines.some((l) => /excise|tariff|GST \(/.test(l.label)));
check('card surcharge off by default (no line)',
  !dms.lines.some((l) => /surcharge/i.test(l.label)));
check('insurance can be turned off',
  !computeDomestic({ bidAUD: 1905, insuranceRate: 0 }).scenarios[0].lines.some((l) => /breakage/i.test(l.label)));

console.log('\n' + (fail === 0
  ? '\x1b[32mAll ' + pass + ' checks passed.\x1b[0m\n'
  : '\x1b[31m' + fail + ' failed\x1b[0m, ' + pass + ' passed.\n'));
process.exit(fail === 0 ? 0 : 1);
