// Validates the text-extraction paths of parser.js against realistic listing
// text, using a minimal document/location mock (querySelector stubbed empty so
// the regex fallbacks are exercised). Run: node test/parser.test.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

let pass = 0, fail = 0;
const check = (name, cond, got) => {
  if (cond) { pass++; console.log('  \x1b[32m✓\x1b[0m ' + name); }
  else { fail++; console.log('  \x1b[31m✗\x1b[0m ' + name + (got !== undefined ? '  — got ' + JSON.stringify(got) : '')); }
};

function mockDoc({ title, body, path }) {
  globalThis.document = {
    title,
    body: { innerText: body },
    querySelector: () => null,        // force text-based fallbacks
    querySelectorAll: () => [],
  };
  globalThis.location = { pathname: path || '/auction/lot/12345', href: 'https://whiskyauctioneer.com' + (path || '/auction/lot/12345') };
}

// Load after globals can exist (functions read document lazily, so order is fine).
require('../src/parser.js');
const parser = { parseListing: () => globalThis.WA.parsers.whiskyauctioneer() };
const awa = () => globalThis.WA.parsers.awa();

console.log('\nBourbon listing (US-origin, slash spec block):');
mockDoc({
  title: 'William Larue Weller 2016 / 75cl / 67.7% | Whisky Auctioneer',
  body: 'William Larue Weller 2016\nBuffalo Trace Antique Collection\n2016 / 75cl / 67.7%\nCurrent Bid\n£800\nBuyer\'s premium 11%',
});
let r = parser.parseListing();
check('bid £800', r.bid === 800, r.bid);
check('volume 0.75 L', r.volumeL === 0.75, r.volumeL);
check('ABV 0.677', Math.abs(r.abv - 0.677) < 1e-9, r.abv);
check('year 2016', r.year === 2016, r.year);
check('origin guessed US (bourbon/Weller)', r.origin === 'US', r.origin);
check('detected as a listing', r.isListing === true, r.isListing);

console.log('\nScotch listing (70cl, ABV with label, no slash block):');
mockDoc({
  title: 'Macallan 18 Year Old Sherry Oak 1990 | Whisky Auctioneer',
  body: 'Macallan 18 Year Old\n70cl\nABV 43%\nWinning Bid: £1,250\nLot located: UK',
});
r = parser.parseListing();
check('bid £1,250 (comma parsed)', r.bid === 1250, r.bid);
check('volume 0.70 L', r.volumeL === 0.7, r.volumeL);
check('ABV 0.43', Math.abs(r.abv - 0.43) < 1e-9, r.abv);
check('origin guessed UK (Macallan/Scotch)', r.origin === 'UK', r.origin);

console.log('\nABV picker ignores stray small percentages (premium 11%):');
mockDoc({
  title: 'Some Whisky 1L 40%',
  body: 'Buyer\'s premium 11% applies. 1L / 40% vol\nCurrent Bid £50',
});
r = parser.parseListing();
check('ABV resolves to 0.40 not 0.11', Math.abs(r.abv - 0.40) < 1e-9, r.abv);
check('volume 1 L', r.volumeL === 1, r.volumeL);

console.log('\nReal page format (lot 8207436 — separate spec tokens, "EU Auction" badge):');
mockDoc({
  title: 'William Larue Weller Straight Bourbon 2016 Release | Whisky Auctioneer',
  // The live page lays specs out as separate inline tokens, not a slash block,
  // and tags the lot "EU Auction".
  body: 'William Larue Weller Straight Bourbon 2016 Release\nSazerac Company\nNew Oak  2016  67.7%  75cl\nEU Auction\nCurrent bid\n£800.00\nMy bid £0.00  My limit £0.00  Bids 31',
});
r = parser.parseListing();
check('real: bid £800', r.bid === 800, r.bid);
check('real: volume 0.75 L (from "75cl")', r.volumeL === 0.75, r.volumeL);
check('real: ABV 0.677 (from "67.7%")', Math.abs(r.abv - 0.677) < 1e-9, r.abv);
check('real: year 2016', r.year === 2016, r.year);
check('real: origin US (bourbon/Weller)', r.origin === 'US', r.origin);
check('real: lot region EU (from "EU Auction")', r.lotRegion === 'EU', r.lotRegion);

console.log('\nLogged-in account chrome must not hijack the bid (regression: £110 bug):');
mockDoc({
  title: 'William Larue Weller Straight Bourbon 2016 Release | Whisky Auctioneer',
  // A logged-in user sees a "Winning 1 £110.00 / Winning bids £110.00" account
  // summary and "My bid £0.00 / Bids 31" — none of which is THIS lot's price.
  body: 'Winning 1 £110.00 Sold 0 £0.00\nWinning bids £110.00\nWilliam Larue Weller Straight Bourbon 2016 Release\nSazerac Company\nNew Oak 2016 67.7% 75cl\nEU Auction\nCurrent bid\n£800.00\nMy bid £0.00 My limit £0.00 Bids 31',
});
r = parser.parseListing();
check('bid is the £800 Current bid, NOT the £110 account figure', r.bid === 800, r.bid);
check('region still EU', r.lotRegion === 'EU', r.lotRegion);

console.log('\nEnded lot shows "Winning bid" (singular) as the price:');
mockDoc({ title: 'Some Lot', body: 'Auction ended\nWinning bid\n£1,450.00\nLot located UK' });
r = parser.parseListing();
check('ended lot: bid £1,450 from "Winning bid"', r.bid === 1450, r.bid);

console.log('\nAustralian Whisky Auctions — ended lot (Final Bid, labelled specs, AUD):');
mockDoc({
  title: 'William Larue Weller Antique Collection Kentucky Straight Bourbon 2016 Release Auction | Australian Whisky Auctions',
  body: 'NEXT AUCTION: 08 DAYS\nWILLIAM LARUE WELLER ANTIQUE COLLECTION KENTUCKY STRAIGHT BOURBON 2016 RELEASE\nFinal Bid:\n$1905.00\nReserve Met\nDISTILLERY / BRAND:\nBuffalo Trace\nSIZE:\n750ml\nSTRENGTH:\n67.70%\nthe ABV of 67.70%. Please closely examine...',
  path: '/lot-681621/william-larue-weller-antique-collection-kentucky-straight-bourbon-2016-release',
});
let a = awa();
check('awa: bid $1905 (from "Final Bid")', a.bid === 1905, a.bid);
check('awa: currency AUD', a.currency === 'AUD', a.currency);
check('awa: volume 0.75 L (from "SIZE: 750ml")', a.volumeL === 0.75, a.volumeL);
check('awa: ABV 0.677 (from "STRENGTH: 67.70%")', Math.abs(a.abv - 0.677) < 1e-9, a.abv);
check('awa: distillery Buffalo Trace', a.distillery === 'Buffalo Trace', a.distillery);
check('awa: origin US (bourbon)', a.origin === 'US', a.origin);
check('awa: detected as a listing (/lot- path)', a.isListing === true, a.isListing);

console.log('\nAWA — live lot ("Current Bid"), ignores stray $ in description:');
mockDoc({
  title: 'Lagavulin 16 Year Old | Australian Whisky Auctions',
  body: 'LAGAVULIN 16 YEAR OLD\nThe record price was $17,000 at a charity event.\nCurrent Bid:\n$255.00\nSIZE:\n700ml\nSTRENGTH:\n43%',
  path: '/lot-700001/lagavulin-16-year-old',
});
a = awa();
check('awa: bid $255 from "Current Bid", not $17,000 in description', a.bid === 255, a.bid);
check('awa: volume 0.70 L', a.volumeL === 0.7, a.volumeL);
check('awa: ABV 0.43', Math.abs(a.abv - 0.43) < 1e-9, a.abv);
check('awa: origin UK (Lagavulin/Scotch)', a.origin === 'UK', a.origin);

console.log('\n' + (fail === 0
  ? '\x1b[32mAll ' + pass + ' parser checks passed.\x1b[0m\n'
  : '\x1b[31m' + fail + ' failed\x1b[0m, ' + pass + ' passed.\n'));
process.exit(fail === 0 ? 0 : 1);
