/*
 * content.js — mounts the landed-cost panel on a Whisky Auctioneer listing.
 *
 * Loads after calc.js + parser.js (see manifest order). Renders an isolated
 * (shadow DOM) panel: parsed-but-editable listing inputs at the top, three
 * routing scenarios sorted cheapest-first below, and an editable assumptions
 * drawer. Recomputes on every change. Assumptions persist via chrome.storage.
 */
(function () {
  'use strict';
  if (window.__waLandedCostMounted) return;
  window.__waLandedCostMounted = true;

  const WA = window.WA;

  // Which site are we on? Selects the cost model and the panel layout.
  const site = WA.pickSite(location.hostname) || Object.values(WA.sites)[0];
  const isImport = site.kind === 'import';
  const MODEL = isImport ? WA.calc.compute : WA.calc.computeDomestic;
  const MDEFAULTS = isImport ? WA.calc.DEFAULTS : WA.calc.DOMESTIC_DEFAULTS;

  const STORE_KEY = 'wa_overrides_' + site.kind; // per-model overrides (import vs domestic differ)
  const LEGACY_KEY = 'wa_assumptions';           // pre-1.x persisted the whole object — migrate away

  // Listing inputs (parsed, then user-editable in-session). `bid` is in the
  // site's native currency (GBP for import, AUD for domestic).
  let listing = {};
  // Working rates = engine defaults with the user's explicit overrides layered on
  // top. Persisting the full object would freeze old defaults in storage and let
  // them shadow future updates, so only `overrides` is saved.
  let overrides = {};
  let assumptions = pickAssumptions(MDEFAULTS);
  let fxDate = null;
  let collapsed = false;
  let showAssumptions = false;

  // ---------------------------------------------------------------------------
  // Boot — defined here, invoked at the very end of the IIFE so every `let`
  // (root, host, …) is initialised before the (possibly synchronous in tests)
  // storage callback fires mount().
  // ---------------------------------------------------------------------------
  function boot() {
    loadAssumptions(() => {
      rescan();
      mount();
      render();
      fetchLiveFX(); // best-effort; updates FX field when it returns
      observeSpaNavigation();
      startParseRetries(); // AWA hydrates the bid after document_idle — re-parse until complete
    });
  }

  // ---------------------------------------------------------------------------
  // Some sites (AWA) render the bid client-side after document_idle, so the
  // boot-time parse can miss it. Retry with backoff, filling ONLY fields that
  // are still empty — never overwriting values the user has typed — until the
  // listing is complete or attempts run out (~12 s).
  // ---------------------------------------------------------------------------
  const RETRY_DELAYS = [400, 800, 1600, 3200, 6400];
  let retryTimer = null;
  function listingIncomplete() {
    return listing.bid == null || listing.volumeL == null || listing.abv == null;
  }
  function startParseRetries() {
    clearTimeout(retryTimer);
    let attempt = 0;
    const tick = () => {
      if (!listingIncomplete()) return;
      const p = site.parse() || {};
      let changed = false;
      for (const k of ['title', 'bid', 'volumeL', 'abv', 'year', 'distillery', 'lotRegion', 'origin']) {
        if ((listing[k] == null || listing[k] === '') && p[k] != null && p[k] !== '') {
          listing[k] = p[k];
          changed = true;
        }
      }
      if (p.isListing && !listing.isListing) { listing.isListing = true; changed = true; }
      if (changed && !collapsed) {
        // A full render would steal focus mid-typing; recompute totals only then.
        if (root.activeElement) liveRecompute();
        else render();
      }
      if (listingIncomplete() && attempt < RETRY_DELAYS.length) {
        retryTimer = setTimeout(tick, RETRY_DELAYS[attempt++]);
      }
    };
    retryTimer = setTimeout(tick, RETRY_DELAYS[attempt++]);
  }

  function rescan() {
    const p = site.parse() || {};
    listing = {
      title: p.title || '',
      bid: p.bid,
      volumeL: p.volumeL,
      abv: p.abv,
      year: p.year,
      distillery: p.distillery || null,
      lotRegion: p.lotRegion || listing.lotRegion || null,
      origin: p.origin || listing.origin || null,
      currency: p.currency || site.currency,
      isListing: p.isListing,
    };
  }

  // ---------------------------------------------------------------------------
  // DOM scaffold (shadow root keeps the host site's CSS out)
  // ---------------------------------------------------------------------------
  let root, host;
  function mount() {
    host = document.createElement('div');
    host.id = 'wa-landed-cost-host';
    host.style.cssText = 'all:initial; position:fixed; z-index:2147483647;';
    (document.body || document.documentElement).appendChild(host);
    root = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = CSS;
    root.appendChild(style);
    const wrap = document.createElement('div');
    wrap.id = 'wrap';
    root.appendChild(wrap);
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  function render() {
    const wrap = root.getElementById('wrap');
    if (collapsed) { wrap.innerHTML = launcherHTML(); wireLauncher(); return; }

    const inputs = currentInputs();
    const result = MODEL(inputs);

    wrap.innerHTML = `
      <div class="panel">
        <header class="hdr" id="drag">
          <div class="hdr-title">🥃 Landed cost <span class="ccy">AUD</span></div>
          <div class="hdr-actions">
            <button class="icon" id="rescan" title="Re-scan page">⟳</button>
            <button class="icon" id="collapse" title="Collapse">—</button>
          </div>
        </header>

        <div class="site-tag">${esc(site.name)}</div>
        ${listing.title ? `<div class="lot">${esc(listing.title)}</div>` : ''}
        ${!listing.isListing ? `<div class="warn">No listing auto-detected — enter the lot details below.</div>` : ''}

        ${inputsHTML()}

        <section class="scenarios">
          ${scenariosHTML(result)}
        </section>

        <button class="assume-toggle" id="assumeToggle">
          ${showAssumptions ? '▾' : '▸'} Rates &amp; fees <span class="asof">as of ${esc(result.asOf)}${isImport && fxDate ? ' · FX ' + esc(fxDate) : ''}</span>
        </button>
        ${showAssumptions ? assumptionsHTML() : ''}

        <footer class="note">${footerNote()}</footer>
      </div>`;

    wireEvents();
    makeDraggable();
  }

  // Inputs section — editable bid in the site's currency, plus the fields the
  // model actually needs. Import needs volume/ABV/origin/region; domestic needs
  // none of them (no excise, no routing), so it just shows them as info.
  function inputsHTML() {
    if (isImport) {
      return `
        <section class="inputs">
          <label class="fld wide">
            <span>Your max bid <em>(£)</em></span>
            <input id="bid" type="number" min="0" step="1" value="${valOf(listing.bid)}" />
          </label>
          ${listing.bid != null ? `<div class="hint-row">Detected current bid: ${esc(fmtBid(listing.bid))}</div>` : ''}
          <div class="row3">
            <label class="fld"><span>Volume <em>(L)</em></span>
              <input id="vol" type="number" min="0" step="0.01" value="${valOf(listing.volumeL)}" /></label>
            <label class="fld"><span>ABV <em>(%)</em></span>
              <input id="abv" type="number" min="0" max="100" step="0.1" value="${listing.abv != null ? round1(listing.abv * 100) : ''}" /></label>
            <label class="fld"><span>Origin</span>
              <select id="origin">${opt('UK', listing.origin)}${opt('EU', listing.origin)}${opt('US', listing.origin)}${opt('Other', listing.origin)}</select></label>
          </div>
          <div class="seg-row">
            <span class="seg-label">Lot sits in</span>
            <div class="seg" id="region">
              <button data-v="UK" class="${listing.lotRegion === 'UK' ? 'on' : ''}">🇬🇧 UK</button>
              <button data-v="EU" class="${listing.lotRegion === 'EU' ? 'on' : ''}">🇪🇺 EU</button>
            </div>
          </div>
        </section>`;
    }
    // domestic
    const info = [
      listing.volumeL != null ? (listing.volumeL >= 1 ? listing.volumeL + ' L' : Math.round(listing.volumeL * 1000) + ' ml') : null,
      listing.abv != null ? round1(listing.abv * 100) + '%' : null,
      listing.distillery || null,
    ].filter(Boolean).join(' · ');
    return `
      <section class="inputs">
        <label class="fld wide">
          <span>Your max bid <em>(A$)</em></span>
          <input id="bid" type="number" min="0" step="1" value="${valOf(listing.bid)}" />
        </label>
        ${listing.bid != null ? `<div class="hint-row">Detected bid: ${esc(fmtBid(listing.bid))}</div>` : ''}
        ${info ? `<div class="hint-row">${esc(info)}</div>` : ''}
      </section>`;
  }

  function footerNote() {
    if (isImport) {
      return `Estimate only. Duty &amp; excise rates change (AU excise re-indexes Feb &amp; Aug).
        Carry-home figures assume the bottle is carried within the <strong>2.25 L per-adult
        alcohol allowance, declared truthfully</strong> on arrival — that allowance is by total
        volume, so several bottles can share it; volume over it is taxed at the posted (Direct) rates.`;
    }
    return `Estimate only. The lot is already in Australia, so there's no import duty, excise or
      tariff and no UK/EU routing. Buyer's premium is GST-inclusive; confirm fees and shipping
      against ${esc(site.name)}'s current schedule (all editable above).`;
  }

  // Build the scenario cards. Hide carry routes that don't apply to this lot:
  //  • crossBorder  — staging across the Brexit line (always wipes the saving)
  //  • overAllowance — the lot's volume exceeds the per-adult carry allowance,
  //    so it can't be carried in tax-free; posted (Direct) treatment applies.
  // Shared by render() and liveRecompute() so a typed volume re-filters live.
  function scenariosHTML(result) {
    const visible = result.scenarios.filter((s) => !s.crossBorder && !s.overAllowance);
    const sorted = visible.slice().sort((a, b) => a.total - b.total);
    const directS = result.scenarios.find((s) => s.id === 'direct'); // absent in the domestic model
    const ctx = { cheapest: sorted[0], directTotal: directS ? directS.total : null, single: sorted.length <= 1 };
    let html = sorted.map((s) => scenarioCard(s, ctx)).join('');
    const over = result.scenarios.find((s) => s.overAllowance && !s.crossBorder);
    if (over) {
      const v = result.inputs.volumeL, a = result.inputs.allowanceL;
      html += `<div class="over-note">Carry-home not shown: this lot is ${v} L, over the ${a} L
        per-adult carry allowance, so posted (Direct) tax applies. Raise the allowance under
        Rates &amp; fees if more adults are travelling.</div>`;
    }
    return html;
  }

  function scenarioCard(s, ctx) {
    const isCheapest = s.id === ctx.cheapest.id;
    const highlight = isCheapest && !ctx.single; // no "winner" styling when there's nothing to compare
    let tag = '';
    if (highlight) tag = `<span class="badge best">CHEAPEST</span>`;
    else if (s.crossBorder) tag = `<span class="badge warnb">no saving</span>`;

    let subline;
    if (ctx.single) {
      subline = `<span class="delta neutral">total delivered cost</span>`;
    } else if (isCheapest) {
      subline = (s.id === 'direct' || ctx.directTotal == null)
        ? `<span class="delta neutral">cheapest available</span>`
        : `<span class="delta good">saves ${money(ctx.directTotal - s.total)} vs Direct</span>`;
    } else {
      subline = `<span class="delta bad">+${money(s.total - ctx.cheapest.total)} vs cheapest</span>`;
    }

    return `
      <div class="card ${highlight ? 'best' : ''}">
        <div class="card-head" data-toggle="${s.id}">
          <div class="card-titles">
            <div class="card-title">${esc(s.label)} ${tag}</div>
            <div class="card-sub">${esc(s.sub)}</div>
          </div>
          <div class="card-total">${money(s.total)}<span class="caret">▸</span></div>
        </div>
        <div class="card-sub2">${subline}</div>
        <div class="breakdown" data-bd="${s.id}" hidden>
          ${s.lines.map(bdLine).join('')}
          <div class="bd total"><span>Total</span><span>${money(s.total)}</span></div>
          ${s.note ? `<div class="bd-note">${esc(s.note)}</div>` : ''}
        </div>
      </div>`;
  }

  function bdLine(l) {
    const cls = l.kind === 'subtotal' ? 'bd sub' : l.kind === 'free' ? 'bd free' : l.kind === 'muted' ? 'bd muted' : 'bd';
    const amt = l.kind === 'free' ? 'A$0' : money(l.amount);
    const hint = l.hint ? ` <span class="bd-hint" title="${esc(l.hint)}">ⓘ</span>` : '';
    return `<div class="${cls}"><span>${esc(l.label)}${hint}</span><span>${amt}</span></div>`;
  }

  function assumptionsHTML() {
    const a = assumptions;
    if (!isImport) {
      return `
        <section class="assume">
          <div class="arow">
            <label class="fld" title="Australian Whisky Auctions buyer's premium is 10%, GST-inclusive."><span>Buyer's premium (%)</span><input data-a="premiumRate" type="number" step="0.5" value="${round2(a.premiumRate * 100)}"></label>
            <label class="fld" title="Optional loss & breakage cover (~2% of hammer + premium). Set 0 to skip."><span>Insurance (%)</span><input data-a="insuranceRate" type="number" step="0.5" value="${round2(a.insuranceRate * 100)}"></label>
          </div>
          <div class="arow">
            <label class="fld"><span>Insurance charged on</span>
              <select data-a="insuranceBase">
                <option value="fob" ${a.insuranceBase === 'fob' ? 'selected' : ''}>Hammer + premium</option>
                <option value="hammer" ${a.insuranceBase === 'hammer' ? 'selected' : ''}>Hammer only</option>
              </select>
            </label>
            <label class="fld" title="Merchant fee if paying by card. Set 0 for bank transfer."><span>Card surcharge (%)</span><input data-a="cardSurchargeRate" type="number" step="0.5" value="${round2(a.cardSurchargeRate * 100)}"></label>
          </div>
          <label class="fld"><span>Domestic shipping (A$)</span><input data-a="shippingAUD" type="number" step="5" value="${a.shippingAUD}"></label>
          <button class="reset" id="reset">Reset rates to defaults</button>
        </section>`;
    }
    return `
      <section class="assume">
        <div class="arow">
          <label class="fld"><span>Buyer's premium (%)</span><input data-a="premiumRate" type="number" step="0.5" value="${round2(a.premiumRate * 100)}"></label>
          <label class="fld"><span>Insurance (%)</span><input data-a="insuranceRate" type="number" step="0.5" value="${round2(a.insuranceRate * 100)}"></label>
        </div>
        <div class="arow">
          <label class="fld"><span>Insurance charged on</span>
            <select data-a="insuranceBase">
              <option value="fob" ${a.insuranceBase === 'fob' ? 'selected' : ''}>Hammer + premium</option>
              <option value="hammer" ${a.insuranceBase === 'hammer' ? 'selected' : ''}>Hammer only</option>
            </select>
          </label>
          <label class="fld" title="Whisky Auctioneer charges 3.5% on non-UK/EEA cards. Set to 3.5 if paying by card; 0 for bank transfer.">
            <span>Card surcharge (%) <em>non-UK card</em></span>
            <input data-a="cardSurchargeRate" type="number" step="0.5" value="${round2(a.cardSurchargeRate * 100)}">
          </label>
        </div>
        <div class="arow">
          <label class="fld"><span>FX GBP→AUD</span>
            <span class="fx-wrap"><input data-a="fxGBPAUD" type="number" step="0.001" value="${a.fxGBPAUD}"><button class="mini" id="liveFx" title="Fetch live rate">live</button></span>
          </label>
          <label class="fld"><span>FX EUR→AUD</span><input data-a="fxEURAUD" type="number" step="0.001" value="${a.fxEURAUD}"></label>
        </div>
        <div class="arow">
          <label class="fld"><span>Freight to AU (A$)</span><input data-a="freightDirectAUD" type="number" step="5" value="${a.freightDirectAUD}"></label>
          <label class="fld" title="In-region leg to your staging address, in GBP (e.g. intra-EU = £14)."><span>In-region ship (£)</span><input data-a="inRegionShipGBP" type="number" step="1" value="${a.inRegionShipGBP}"></label>
        </div>
        <div class="arow">
          <label class="fld"><span>AU excise / LPA (A$)</span><input data-a="auExcisePerLPA" type="number" step="0.01" value="${a.auExcisePerLPA}"></label>
          <label class="fld"><span>UK excise / LPA (£)</span><input data-a="ukExcisePerLPA_GBP" type="number" step="0.01" value="${a.ukExcisePerLPA_GBP}"></label>
        </div>
        <label class="fld" title="Total beverage volume you can carry tax-free per adult (2.25 L). Raise it for extra adult travellers — e.g. 4.5 L for two.">
          <span>Carry allowance (L) <em>per adult</em></span>
          <input data-a="auConcessionLitres" type="number" step="0.25" min="0" value="${a.auConcessionLitres}">
        </label>
        <button class="reset" id="reset">Reset rates to defaults</button>
      </section>`;
  }

  // ---------------------------------------------------------------------------
  // Inputs → engine
  // ---------------------------------------------------------------------------
  function currentInputs() {
    if (!isImport) {
      return Object.assign({}, assumptions, { bidAUD: numOr(listing.bid, 0) });
    }
    return Object.assign({}, assumptions, {
      bidGBP: numOr(listing.bid, 0),
      volumeL: numOr(listing.volumeL, 0),
      abv: numOr(listing.abv, 0),
      origin: listing.origin || 'Other',
      lotRegion: listing.lotRegion || 'UK',
    });
  }

  // ---------------------------------------------------------------------------
  // Wiring
  // ---------------------------------------------------------------------------
  function wireEvents() {
    const $ = (id) => root.getElementById(id);

    $('rescan').onclick = () => { rescan(); render(); fetchLiveFX(); startParseRetries(); };
    $('collapse').onclick = () => { collapsed = true; render(); };
    $('assumeToggle').onclick = () => { showAssumptions = !showAssumptions; render(); };

    bindNum($('bid'), (v) => { listing.bid = v; });
    bindNum($('vol'), (v) => { listing.volumeL = v; });
    bindNum($('abv'), (v) => { listing.abv = v == null ? null : v / 100; });
    if ($('origin')) $('origin').onchange = (e) => { listing.origin = e.target.value; render(); };

    root.querySelectorAll('#region button').forEach((b) => {
      b.onclick = () => { listing.lotRegion = b.dataset.v; render(); };
    });

    // Scenario breakdown expand/collapse
    root.querySelectorAll('[data-toggle]').forEach((h) => {
      h.onclick = () => {
        const id = h.getAttribute('data-toggle');
        const bd = root.querySelector(`[data-bd="${id}"]`);
        const card = h.closest('.card');
        if (bd) { bd.hidden = !bd.hidden; card.classList.toggle('open', !bd.hidden); }
      };
    });

    // Assumptions
    root.querySelectorAll('[data-a]').forEach((inp) => {
      const key = inp.getAttribute('data-a');
      inp.onchange = () => {
        let v = inp.type === 'number' ? parseFloat(inp.value) : inp.value;
        if (key === 'premiumRate' || key === 'insuranceRate' || key === 'cardSurchargeRate') v = (parseFloat(inp.value) || 0) / 100;
        assumptions[key] = v;
        overrides[key] = v; // remember only what the user actually changed
        saveOverrides();
        render();
      };
    });
    if ($('liveFx')) $('liveFx').onclick = () => fetchLiveFX(true);
    if ($('reset')) $('reset').onclick = () => {
      overrides = {};
      assumptions = pickAssumptions(MDEFAULTS);
      saveOverrides();
      render();
      fetchLiveFX();
    };
  }

  function bindNum(inp, set) {
    if (!inp) return;
    inp.oninput = () => {
      const v = inp.value === '' ? null : parseFloat(inp.value);
      set(Number.isFinite(v) ? v : null);
      liveRecompute(); // update totals without full re-render (keeps focus)
    };
  }

  // Lightweight recompute that only rewrites scenario cards, preserving input focus.
  function liveRecompute() {
    const result = MODEL(currentInputs());
    const sec = root.querySelector('.scenarios');
    if (sec) sec.innerHTML = scenariosHTML(result);
    // re-wire just the new cards' toggles
    root.querySelectorAll('[data-toggle]').forEach((h) => {
      h.onclick = () => {
        const id = h.getAttribute('data-toggle');
        const bd = root.querySelector(`[data-bd="${id}"]`);
        const card = h.closest('.card');
        if (bd) { bd.hidden = !bd.hidden; card.classList.toggle('open', !bd.hidden); }
      };
    });
  }

  function launcherHTML() {
    return `<button class="fab" id="fab" title="Landed-cost calculator">🥃 $</button>`;
  }
  function wireLauncher() {
    const fab = root.getElementById('fab');
    if (fab) fab.onclick = () => { collapsed = false; render(); };
  }

  // ---------------------------------------------------------------------------
  // FX (via background worker)
  // ---------------------------------------------------------------------------
  function fetchLiveFX(force) {
    if (!isImport) return; // domestic model has no FX leg
    try {
      chrome.runtime.sendMessage({ type: 'WA_FETCH_FX' }, (resp) => {
        if (chrome.runtime.lastError || !resp || !resp.ok) return; // stay on defaults
        // Live FX is a per-session refresh, not a user override — update in
        // memory only, never persist it (persisting would shadow the default).
        if (!('fxGBPAUD' in overrides)) assumptions.fxGBPAUD = resp.fxGBPAUD;
        if (resp.fxEURAUD && !('fxEURAUD' in overrides)) assumptions.fxEURAUD = resp.fxEURAUD;
        fxDate = resp.date;
        if (!collapsed) render();
      });
    } catch (_) { /* offline / context invalidated — keep defaults */ }
  }

  // ---------------------------------------------------------------------------
  // Persistence
  // ---------------------------------------------------------------------------
  function loadAssumptions(done) {
    try {
      chrome.storage.local.get([STORE_KEY], (res) => {
        overrides = (res && res[STORE_KEY]) ? res[STORE_KEY] : {};
        assumptions = Object.assign(pickAssumptions(MDEFAULTS), overrides);
        done();
      });
      // Drop the old whole-object blob that used to shadow new defaults.
      if (chrome.storage.local.remove) chrome.storage.local.remove(LEGACY_KEY);
    } catch (_) { done(); }
  }
  function saveOverrides() {
    try { chrome.storage.local.set({ [STORE_KEY]: overrides }); } catch (_) {}
  }
  function pickAssumptions(d) {
    if (!isImport) {
      return {
        premiumRate: d.premiumRate, insuranceRate: d.insuranceRate, insuranceBase: d.insuranceBase,
        cardSurchargeRate: d.cardSurchargeRate, shippingAUD: d.shippingAUD,
      };
    }
    return {
      premiumRate: d.premiumRate, insuranceRate: d.insuranceRate, insuranceBase: d.insuranceBase,
      cardSurchargeRate: d.cardSurchargeRate,
      fxGBPAUD: d.fxGBPAUD, fxEURAUD: d.fxEURAUD,
      freightDirectAUD: d.freightDirectAUD, inRegionShipGBP: d.inRegionShipGBP,
      auExcisePerLPA: d.auExcisePerLPA, ukExcisePerLPA_GBP: d.ukExcisePerLPA_GBP,
      auConcessionLitres: d.auConcessionLitres,
    };
  }

  // ---------------------------------------------------------------------------
  // SPA navigation — Whisky Auctioneer may swap lots without a full reload.
  // ---------------------------------------------------------------------------
  function observeSpaNavigation() {
    let last = location.href;
    const check = () => {
      if (location.href !== last) { last = location.href; setTimeout(() => { rescan(); if (!collapsed) render(); startParseRetries(); }, 600); }
    };
    setInterval(check, 1000);
  }

  // ---------------------------------------------------------------------------
  // Dragging (by header)
  // ---------------------------------------------------------------------------
  function makeDraggable() {
    const handle = root.getElementById('drag');
    if (!handle) return;
    let sx, sy, ox, oy, dragging = false;
    handle.onmousedown = (e) => {
      if (e.target.closest('button')) return;
      dragging = true;
      const r = host.getBoundingClientRect();
      sx = e.clientX; sy = e.clientY; ox = r.left; oy = r.top;
      host.style.right = 'auto'; host.style.bottom = 'auto';
      host.style.left = ox + 'px'; host.style.top = oy + 'px';
      e.preventDefault();
    };
    window.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      host.style.left = Math.max(0, ox + e.clientX - sx) + 'px';
      host.style.top = Math.max(0, oy + e.clientY - sy) + 'px';
    });
    window.addEventListener('mouseup', () => { dragging = false; });
  }

  // ---------------------------------------------------------------------------
  // Formatting / escaping
  // ---------------------------------------------------------------------------
  function money(n) {
    return 'A$' + Number(n).toLocaleString('en-AU', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  }
  // Bid in the site's native currency (£ for import, A$ for domestic).
  function fmtBid(n) {
    const sym = site.currency === 'GBP' ? '£' : 'A$';
    return sym + Number(n).toLocaleString(site.currency === 'GBP' ? 'en-GB' : 'en-AU', { maximumFractionDigits: 0 });
  }
  function valOf(v) { return v == null ? '' : v; }
  function numOr(v, d) { return Number.isFinite(v) ? v : d; }
  function round1(n) { return Math.round(n * 10) / 10; }
  function round2(n) { return Math.round(n * 100) / 100; }
  function opt(v, cur) { return `<option value="${v}" ${cur === v ? 'selected' : ''}>${v}</option>`; }
  function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  // ---------------------------------------------------------------------------
  // Styles (scoped to the shadow root)
  // ---------------------------------------------------------------------------
  const CSS = `
    :host { all: initial; }
    #wrap, #wrap * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
    .fab { position: fixed; right: 18px; bottom: 18px; width: 52px; height: 52px; border-radius: 50%;
      border: none; background: #1f7a4d; color: #fff; font-size: 18px; font-weight: 700; cursor: pointer;
      box-shadow: 0 6px 20px rgba(0,0,0,.28); }
    .fab:hover { background: #24935c; }
    .panel { position: fixed; right: 18px; bottom: 18px; width: 360px; max-height: 88vh; overflow-y: auto;
      background: #fff; color: #14181d; border-radius: 14px; box-shadow: 0 10px 40px rgba(0,0,0,.32);
      border: 1px solid #e3e7eb; font-size: 13px; }
    .hdr { display: flex; align-items: center; justify-content: space-between; padding: 11px 14px;
      background: #14181d; color: #fff; border-radius: 14px 14px 0 0; cursor: grab; position: sticky; top: 0; z-index: 2; }
    .hdr:active { cursor: grabbing; }
    .hdr-title { font-weight: 700; font-size: 14px; }
    .ccy { font-size: 10px; background: #1f7a4d; padding: 2px 6px; border-radius: 6px; margin-left: 4px; vertical-align: middle; }
    .hdr-actions { display: flex; gap: 4px; }
    .icon { background: rgba(255,255,255,.12); color: #fff; border: none; width: 26px; height: 26px;
      border-radius: 7px; cursor: pointer; font-size: 14px; line-height: 1; }
    .icon:hover { background: rgba(255,255,255,.25); }
    .site-tag { padding: 8px 14px 0; font-size: 9.5px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; color: #97a0a8; }
    .lot { padding: 4px 14px 0; font-weight: 600; font-size: 12.5px; color: #2b3138; }
    .warn { margin: 10px 14px 0; padding: 7px 10px; background: #fff5e0; border: 1px solid #f0d48a;
      color: #7a5a00; border-radius: 8px; font-size: 11.5px; }
    .inputs { padding: 10px 14px 4px; }
    .fld { display: flex; flex-direction: column; gap: 3px; font-size: 11px; color: #5a636c; font-weight: 600; }
    .fld em { font-style: normal; color: #97a0a8; font-weight: 500; }
    .fld input, .fld select { font-size: 14px; color: #14181d; padding: 7px 8px; border: 1px solid #d6dbe0;
      border-radius: 8px; background: #fff; font-weight: 600; width: 100%; }
    .fld input:focus, .fld select:focus { outline: none; border-color: #1f7a4d; box-shadow: 0 0 0 2px rgba(31,122,77,.15); }
    .fld.wide { margin-bottom: 4px; }
    .hint-row { font-size: 10.5px; color: #97a0a8; margin: 2px 0 8px; }
    .row3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; margin-bottom: 9px; }
    .seg-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; }
    .seg-label { font-size: 11px; color: #5a636c; font-weight: 600; }
    .seg { display: flex; gap: 6px; }
    .seg button { border: 1px solid #d6dbe0; background: #fff; padding: 6px 12px; border-radius: 8px;
      cursor: pointer; font-size: 12px; font-weight: 600; color: #5a636c; }
    .seg button.on { background: #14181d; color: #fff; border-color: #14181d; }
    .scenarios { padding: 6px 14px 4px; display: flex; flex-direction: column; gap: 8px; }
    .over-note { padding: 8px 10px; background: #fff5e0; border: 1px solid #f0d48a; color: #7a5a00; border-radius: 8px; font-size: 11px; line-height: 1.45; }
    .card { border: 1px solid #e3e7eb; border-radius: 11px; overflow: hidden; }
    .card.best { border-color: #1f7a4d; box-shadow: 0 0 0 2px rgba(31,122,77,.16); }
    .card-head { display: flex; align-items: flex-start; justify-content: space-between; padding: 10px 12px 4px; cursor: pointer; }
    .card-title { font-weight: 700; font-size: 13px; display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
    .card-sub { font-size: 10.5px; color: #8b949c; margin-top: 2px; }
    .card-total { font-size: 18px; font-weight: 800; white-space: nowrap; display: flex; align-items: center; gap: 4px; }
    .card.best .card-total { color: #1f7a4d; }
    .caret { font-size: 9px; color: #b3bbc2; transition: transform .15s; }
    .card.open .caret { transform: rotate(90deg); }
    .card-sub2 { padding: 0 12px 9px; }
    .delta { font-size: 11px; font-weight: 700; }
    .delta.good { color: #1f7a4d; } .delta.bad { color: #b23b3b; } .delta.neutral { color: #8b949c; }
    .badge { font-size: 9px; font-weight: 800; padding: 2px 6px; border-radius: 5px; letter-spacing: .04em; }
    .badge.best { background: #1f7a4d; color: #fff; }
    .badge.warnb { background: #f3e1e1; color: #b23b3b; }
    .breakdown { padding: 4px 12px 11px; border-top: 1px dashed #e3e7eb; margin-top: 2px; }
    .bd { display: flex; justify-content: space-between; padding: 3px 0; font-size: 12px; color: #3d454d; }
    .bd.sub { font-weight: 700; color: #14181d; border-top: 1px solid #eef1f3; margin-top: 2px; padding-top: 5px; }
    .bd.free { color: #1f7a4d; font-weight: 600; }
    .bd.muted { color: #97a0a8; }
    .bd.total { font-weight: 800; font-size: 13px; border-top: 2px solid #14181d; margin-top: 5px; padding-top: 6px; }
    .bd-hint { cursor: help; color: #b3bbc2; font-size: 10px; }
    .bd-note { font-size: 10.5px; color: #8b949c; margin-top: 7px; line-height: 1.4; font-style: italic; }
    .assume-toggle { width: calc(100% - 28px); margin: 8px 14px 0; background: #f4f6f8; border: 1px solid #e3e7eb;
      border-radius: 8px; padding: 8px 10px; text-align: left; cursor: pointer; font-size: 12px; font-weight: 700; color: #3d454d; }
    .asof { font-weight: 500; color: #97a0a8; font-size: 10.5px; }
    .assume { padding: 8px 14px 0; }
    .arow { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 8px; }
    .assume .fld { margin-bottom: 8px; }
    .fx-wrap { display: flex; gap: 4px; }
    .fx-wrap input { flex: 1; }
    .mini { border: 1px solid #1f7a4d; background: #fff; color: #1f7a4d; border-radius: 7px; padding: 0 8px;
      font-size: 11px; font-weight: 700; cursor: pointer; }
    .mini:hover { background: #1f7a4d; color: #fff; }
    .reset { width: 100%; background: #fff; border: 1px solid #d6dbe0; border-radius: 8px; padding: 7px;
      cursor: pointer; font-size: 11.5px; color: #5a636c; font-weight: 600; margin-bottom: 4px; }
    .note { padding: 11px 14px 14px; font-size: 10.5px; color: #97a0a8; line-height: 1.5; border-top: 1px solid #eef1f3; margin-top: 10px; }
    .note strong { color: #6a7480; }
  `;

  boot();
})();
