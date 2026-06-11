/*
 * parser.js — best-effort extraction of listing data, per auction site.
 *
 * Each site's markup is not a stable contract, so extraction is deliberately
 * defensive: it reads visible text + a few likely selectors, and every field it
 * returns can be overridden by hand in the panel. A miss degrades to a blank
 * field, never a wrong silent number.
 *
 * Exposes globalThis.WA.parsers = { whiskyauctioneer, awa }. Each returns a
 * listing object: { title, bid, volumeL, abv, origin, currency, isListing, ... }.
 */
(function (root) {
  'use strict';
  root.WA = root.WA || {};

  const txt = () => (document.body ? document.body.innerText : '') || '';
  const lower = (s) => (s || '').toLowerCase();

  // --- shared price extraction ----------------------------------------------
  // Anchor on the lot's price LABEL and take the currency figure immediately
  // after it. This deliberately ignores account chrome a logged-in user sees
  // ("Winning 1 £110.00", "My bid £0.00", "Bids 31") — a loose "figure near the
  // word bid" search picks those up and reports the wrong price. `(?!s)` keeps
  // "current/winning bid" from matching plural account labels ("Winning bids").
  function parseLabeledPrice(labels, symbol) {
    const body = txt();
    const low = body.toLowerCase();
    const figure = new RegExp(symbol + '\\s*([\\d,]+(?:\\.\\d+)?)');
    for (const re of labels) {
      let m;
      re.lastIndex = 0;
      while ((m = re.exec(low)) !== null) {
        const after = body.slice(m.index + m[0].length, m.index + m[0].length + 60);
        const p = after.match(figure);
        if (p) return toNum(p[1]);
      }
    }
    return null;
  }

  // Find the value that follows a "LABEL:" spec field (AWA lays specs out as
  // SIZE: / STRENGTH: / DISTILLERY: rows). Tries each occurrence of the label.
  function labelValue(label, valRe) {
    const body = txt();
    const low = body.toLowerCase();
    let idx = low.indexOf(label.toLowerCase());
    while (idx !== -1) {
      const after = body.slice(idx + label.length, idx + label.length + 40);
      const m = after.match(valRe);
      if (m) return m;
      idx = low.indexOf(label.toLowerCase(), idx + 1);
    }
    return null;
  }

  // --- origin guess from name/distillery (overridable) -----------------------
  function guessOrigin(s) {
    s = lower(s);
    const US = /(bourbon|\brye\b|tennessee|kentucky|\bweller\b|pappy|van winkle|buffalo trace|stagg|sazerac|wild turkey|maker'?s mark|woodford|four roses|heaven hill|elijah craig|jack daniel)/;
    const UK = /(scotch|single malt|speyside|islay|highland|lowland|campbeltown|macallan|ardbeg|lagavulin|glen|whisky\b|scotland|springbank|highland park|talisker)/;
    const EU = /(cognac|armagnac|calvados|france|french|irish|ireland|jameson|redbreast|midleton)/;
    if (US.test(s)) return 'US';
    if (EU.test(s)) return 'EU';
    if (UK.test(s)) return 'UK';
    return null;
  }

  // ===========================================================================
  // Whisky Auctioneer (UK/EU import site, prices in GBP)
  // ===========================================================================
  function parseWhiskyAuctioneer() {
    const specs = parseSpecsSlash();
    const bid = parseLabeledPrice(
      [/current\s+bid(?!s)/g, /winning\s+bid(?!s)/g, /sold\s+for/g, /hammer\s+price/g], '£');
    return {
      title: parseTitle(/\s*\|\s*Whisky Auctioneer.*$/i),
      bid,
      volumeL: specs.volumeL,
      abv: specs.abv,
      year: specs.year,
      lotRegion: parseRegion(),
      origin: guessOrigin((document.title || '') + ' ' + firstHeading()),
      currency: 'GBP',
      isListing: looksLikeListing(bid),
    };
  }

  // "2016 / 75cl / 67.7%" slash block, then standalone fallbacks.
  function parseSpecsSlash() {
    const sources = [document.title || '', firstHeading(), txt()];
    let volumeL = null, abv = null, year = null;
    for (const src of sources) {
      const slash = src.match(/(\d{4})\s*\/\s*(\d+(?:\.\d+)?)\s*(cl|ml|l|litres?)\s*\/\s*(\d{1,2}(?:\.\d+)?)\s*%/i);
      if (slash) { year = toNum(slash[1]); volumeL = toLitres(slash[2], slash[3]); abv = toNum(slash[4]) / 100; break; }
    }
    const all = sources.join('  ·  ');
    if (volumeL == null) { const v = all.match(/(\d+(?:\.\d+)?)\s*(cl|ml|litres?|l)\b/i); if (v) volumeL = toLitres(v[1], v[2]); }
    if (abv == null) {
      const cands = [...all.matchAll(/(\d{1,2}(?:\.\d+)?)\s*%(?:\s*(?:abv|vol|alc))?/gi)]
        .map((m) => toNum(m[1])).filter((n) => n >= 20 && n <= 80);
      if (cands.length) abv = cands[0] / 100;
    }
    if (year == null) { const y = all.match(/\b(19|20)\d{2}\b/); if (y) year = toNum(y[0]); }
    return { volumeL, abv, year };
  }

  function parseRegion() {
    // WA tags each lot with an "EU Auction" / "UK Auction" badge (the sale it
    // sits in = its customs territory). Match that plus generic region wording.
    const sel = '[class*="badge" i],[class*="flag" i],[class*="region" i],[class*="location" i],[class*="label" i],[class*="tag" i],[class*="pill" i]';
    for (const el of document.querySelectorAll(sel)) {
      const t = lower(el.textContent).trim();
      if (t.length > 40) continue;
      if (/^eu\b|european union|\beu (lot|auction|stock)\b/.test(t)) return 'EU';
      if (/^uk\b|united kingdom|\buk (lot|auction|stock)\b/.test(t)) return 'UK';
    }
    const body = txt();
    if (/\bEU\s*(lot|auction|stock|located|warehouse)\b/i.test(body)) return 'EU';
    if (/\bUK\s*(lot|auction|stock|located|warehouse)\b/i.test(body)) return 'UK';
    return null;
  }

  // ===========================================================================
  // Australian Whisky Auctions (domestic AU site, prices in AUD)
  //   Specs are labelled rows: SIZE: 750ml / STRENGTH: 67.70% / DISTILLERY: …
  //   Price is "Current Bid: $…" (live) or "Final Bid: $…" (ended).
  // ===========================================================================
  function parseAWA() {
    const bid = parseLabeledPrice(
      [/current\s+bid(?!s)/g, /final\s+bid/g, /winning\s+bid(?!s)/g, /leading\s+bid/g], '\\$');

    let volumeL = null;
    const sizeM = labelValue('size', /(\d+(?:\.\d+)?)\s*(ml|cl|l)\b/i);
    if (sizeM) volumeL = toLitres(sizeM[1], sizeM[2]);
    if (volumeL == null) { const v = txt().match(/(\d+(?:\.\d+)?)\s*(ml|cl|l)\b/i); if (v) volumeL = toLitres(v[1], v[2]); }

    let abv = null;
    const strM = labelValue('strength', /(\d{1,2}(?:\.\d+)?)\s*%/);
    if (strM) abv = toNum(strM[1]) / 100;
    if (abv == null) {
      const cands = [...txt().matchAll(/(\d{1,2}(?:\.\d+)?)\s*%/g)].map((m) => toNum(m[1])).filter((n) => n >= 20 && n <= 80);
      if (cands.length) abv = cands[0] / 100;
    }

    // Anchor on the "DISTILLERY / BRAND:" spec field — require a newline before
    // the value so the word "distillery" in description prose is skipped.
    const distM = txt().match(/distillery(?:\s*\/\s*brand)?\s*:?\s*\n\s*([A-Za-z][^\n]{1,40})/i);
    const distillery = distM ? distM[1].trim() : null;
    const title = parseTitle(/\s*Auction\s*\|\s*Australian Whisky Auctions.*$/i);
    return {
      title,
      bid,
      volumeL,
      abv,
      distillery,
      origin: guessOrigin(title + ' ' + (distillery || '')),
      currency: 'AUD',
      isListing: /\/lot-\d+/i.test(location.pathname) || /current\s+bid|final\s+bid/i.test(txt()),
    };
  }

  // --- shared helpers --------------------------------------------------------
  function parseTitle(stripRe) {
    const h = firstHeading();
    if (h) return h.trim().slice(0, 120);
    return (document.title || '').replace(stripRe, '').trim().slice(0, 120);
  }
  function firstHeading() {
    const h = document.querySelector('h1, h2[class*="title" i], [class*="lot-title" i], [class*="product-title" i]');
    return h ? h.textContent : '';
  }
  function looksLikeListing(bid) {
    if (/\/(lot|auction|item|product)s?[-/]/.test(location.pathname.toLowerCase())) return true;
    return bid != null && /bid/i.test(txt());
  }
  function toNum(s) { const n = parseFloat(String(s).replace(/,/g, '')); return Number.isFinite(n) ? n : null; }
  function toLitres(value, unit) {
    const n = toNum(value);
    if (n == null) return null;
    const u = lower(unit);
    if (u.startsWith('ml')) return n / 1000;
    if (u.startsWith('cl')) return n / 100;
    return n;
  }

  root.WA.parsers = { whiskyauctioneer: parseWhiskyAuctioneer, awa: parseAWA };
})(typeof globalThis !== 'undefined' ? globalThis : this);
