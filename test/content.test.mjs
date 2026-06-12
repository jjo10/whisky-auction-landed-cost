// Boots the real content script headless over a stubbed DOM and asserts on the
// panel HTML it renders. Covers the no-bid gate (a browse page must never show
// a dollar figure — regression: "A$14 delivered" on australianwhiskyauctions
// browse pages, which was just default shipping on a $0 hammer) and the
// late-bid hydration path (placeholder until the retry parse finds the bid).
// Run: node test/content.test.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

let pass = 0, fail = 0;
const check = (name, cond, got) => {
  if (cond) { pass++; console.log('  \x1b[32m✓\x1b[0m ' + name); }
  else { fail++; console.log('  \x1b[31m✗\x1b[0m ' + name + (got !== undefined ? '  — got ' + JSON.stringify(got) : '')); }
};

// ---------------------------------------------------------------------------
// Minimal DOM stubs. Elements store innerHTML as a plain string — assertions
// run against that string, no HTML parsing. getElementById on the shadow root
// resolves real appended children (the #wrap panel); unknown ids get a dummy
// object so wireEvents' handler assignments don't throw.
// ---------------------------------------------------------------------------
let lastShadow = null;

function stubEl(tag) {
  const el = {
    tag, id: '', style: {}, textContent: '', innerHTML: '', children: [],
    appendChild(c) { el.children.push(c); return c; },
    attachShadow() { lastShadow = stubShadowRoot(); return lastShadow; },
  };
  return el;
}

function stubShadowRoot() {
  const kids = [];
  return {
    activeElement: null,
    appendChild(c) { kids.push(c); return c; },
    getElementById(id) {
      return kids.find((k) => k.id === id) || { value: '', onclick: null, oninput: null, onchange: null };
    },
    querySelector: () => null,
    querySelectorAll: () => [],
  };
}

// Captured (not scheduled) timers — fireTimers() drains the parse-retry queue
// deterministically. The retry chain is bounded by RETRY_DELAYS, so this ends.
const timers = [];
globalThis.setTimeout = (fn) => { timers.push(fn); return timers.length; };
globalThis.clearTimeout = () => {};
globalThis.setInterval = () => 0;
function fireTimers() { while (timers.length) timers.shift()(); }

globalThis.chrome = {
  storage: { local: { get: (_k, cb) => cb({}), set() {}, remove() {} } },
  runtime: { sendMessage() {} }, // FX fetch: never answers — defaults stay
};

// Load the engine/parser/site registry once (they attach to globalThis.WA).
require('../src/calc.js');
require('../src/parser.js');
require('../src/sites.js');

// Boot the content script fresh against a mocked page; returns the panel wrap.
function bootContent({ hostname, title, body, path }) {
  timers.length = 0;
  globalThis.document = {
    title,
    body: { innerText: body, appendChild() {} },
    createElement: (tag) => stubEl(tag),
    querySelector: () => null,
    querySelectorAll: () => [],
  };
  globalThis.location = { hostname, pathname: path, href: 'https://' + hostname + path };
  globalThis.window = { WA: globalThis.WA, addEventListener() {}, __waLandedCostMounted: false };
  delete require.cache[require.resolve('../src/content.js')];
  require('../src/content.js'); // storage callback is synchronous here → renders immediately
  return lastShadow.getElementById('wrap');
}

console.log('\nAWA browse page (no lot, no bid) must not show a dollar figure:');
let wrap = bootContent({
  hostname: 'australianwhiskyauctions.com.au',
  path: '/may-2026',
  title: 'Browse Whisky Auctions | Australian Whisky Auctions',
  // Grid of lot cards — prices everywhere, but no Current/Final Bid label.
  body: 'NEXT AUCTION: 07 DAYS\n2099 LOTS LIVE\nMackey 6 Year Old Port Cask First Release\n$615.00\nVIEW LOT\nBen Nevis 1973 52 Year Old\n$1465.00\nVIEW LOT',
});
check('no-listing warning shown', wrap.innerHTML.includes('No listing auto-detected'));
check('no scenario card rendered', !wrap.innerHTML.includes('card-total'), wrap.innerHTML.match(/card-total.{0,40}/));
check('placeholder asks for a bid instead', wrap.innerHTML.includes('no-bid') && wrap.innerHTML.includes('Enter your max bid'));
check('domestic wording ("delivered cost")', wrap.innerHTML.includes('estimated delivered cost'));

console.log('\nAWA lot page — bid hydrates after boot (retry parse):');
const lotDoc = {
  hostname: 'australianwhiskyauctions.com.au',
  path: '/lot-700001/lagavulin-16-year-old',
  title: 'Lagavulin 16 Year Old | Australian Whisky Auctions',
  body: 'LAGAVULIN 16 YEAR OLD\nSIZE:\n700ml\nSTRENGTH:\n43%', // bid not rendered yet
};
wrap = bootContent(lotDoc);
check('before hydration: placeholder, no total', wrap.innerHTML.includes('no-bid') && !wrap.innerHTML.includes('card-total'));
globalThis.document.body.innerText = lotDoc.body + '\nCurrent Bid:\n$255.00';
fireTimers(); // drain the bounded retry schedule
check('after hydration: scenario card appears', wrap.innerHTML.includes('card-total'));
check('after hydration: placeholder gone', !wrap.innerHTML.includes('no-bid'));
check('total = hammer + 10% premium + 1.5% insurance + $14 ship (A$298)', wrap.innerHTML.includes('A$298'), wrap.innerHTML.match(/card-total">[^<]*/));

console.log('\nWhisky Auctioneer browse page (import) — same gate, import wording:');
wrap = bootContent({
  hostname: 'whiskyauctioneer.com',
  path: '/current-auctions',
  title: 'Current auctions | Whisky Auctioneer',
  body: 'Current auctions\nThousands of lots\nEnds Sunday',
});
check('no scenario card rendered', !wrap.innerHTML.includes('card-total'));
check('import wording ("landed cost")', wrap.innerHTML.includes('estimated landed cost'));

console.log('\nWhisky Auctioneer lot page with a parsed bid renders scenarios:');
wrap = bootContent({
  hostname: 'whiskyauctioneer.com',
  path: '/auction/lot/8207436',
  title: 'William Larue Weller Straight Bourbon 2016 Release | Whisky Auctioneer',
  body: 'William Larue Weller Straight Bourbon 2016 Release\nNew Oak  2016  67.7%  75cl\nEU Auction\nCurrent bid\n£800.00',
});
check('scenario cards rendered', wrap.innerHTML.includes('card-total'));
check('no placeholder', !wrap.innerHTML.includes('no-bid'));

console.log('\n' + (fail === 0
  ? '\x1b[32mAll ' + pass + ' content-script checks passed.\x1b[0m\n'
  : '\x1b[31m' + fail + ' failed\x1b[0m, ' + pass + ' passed.\n'));
process.exit(fail === 0 ? 0 : 1);
