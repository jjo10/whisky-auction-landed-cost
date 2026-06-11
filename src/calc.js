/*
 * calc.js — Landed-cost calculation core for an Australian (NSW) buyer importing
 * a single bottle won on Whisky Auctioneer.
 *
 * Pure, side-effect-free. Works both as a content-script global (globalThis.WA.calc)
 * and as a Node module (module.exports) so the maths can be unit-tested headless.
 *
 * All money inside the engine is normalised to AUD. GBP/EUR inputs are converted up
 * front using the supplied FX rates. Percentages are stored as fractions (0.11 = 11%).
 *
 * Rates are DATE-STAMPED. They drift — re-check the sources noted in DEFAULTS.asOf.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.WA = root.WA || {};
  root.WA.calc = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Default rates / assumptions. Everything here is user-overridable in the UI.
  // ---------------------------------------------------------------------------
  const DEFAULTS = {
    asOf: '2026-02', // excise re-indexes every Feb & Aug; verify before trusting.

    // FX — the single biggest lever on the total. Fetched live when possible.
    fxGBPAUD: 1.875,
    fxEURAUD: 1.65, // only used to value EU excise/VAT in the "wrong region" EU case.

    // Whisky Auctioneer fees (confirmed against their published schedule Jun 2026; editable).
    premiumRate: 0.125,     // buyer's commission, % of hammer (ex-VAT). Brief assumed ~11%.
    insuranceRate: 0.04,    // loss & breakage cover, % of hammer (confirmed 4%; brief assumed ~2%).
    insuranceBase: 'hammer',// 'hammer' or 'fob' (= hammer + premium).
    cardSurchargeRate: 0,   // 3.5% applies to non-UK/EEA cards; default off — set to 0.035 if paying by card.

    // Australian import (Feb 2026).
    auExcisePerLPA: 107.99, // AUD per litre of pure alcohol. Re-indexed Feb & Aug.
    auGST: 0.10,
    auTariff: 0.05,         // % of FOB/customs value; waived for UK-origin under A-UK FTA.
    auSacThresholdAUD: 1000,// govt/broker formal-entry fees only above this FOB.
    auImportDeclaration: 50,
    auBiosecurityAir: 45,
    auDisbursementMin: 23.10, // DHL: greater of this or 3% of duty+tax...
    auDisbursementPct: 0.03,  // ...then GST on the fee.
    auConcessionLitres: 2.25, // per adult 18+; volumetric, no value cap.

    // UK side (Feb 2026; verify on gov.uk). Only bites when staging an EU lot in the UK.
    ukExcisePerLPA_GBP: 33.99, // spirits >22% ABV.
    ukImportVAT: 0.20,
    ukCustomsDuty: 0.00,       // spirits ~0%.

    // EU side. Only bites when staging a UK lot in the EU.
    euExcisePerLPA_EUR: 10,    // low; rarely billed on a single duty-paid bottle.
    euImportVAT: 0.22,         // representative EU rate; editable.
    euExciseBilledIntra: false,// intra-EU duty-paid move: local excise usually unbilled.

    // Shipping (editable).
    freightDirectAUD: 80,      // DHL door-to-door to AU (AUD), incl. air biosecurity handling.
    inRegionShipGBP: 14,       // in-region leg to your staging address (GBP, e.g. intra-EU = £14).
  };

  const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

  // A breakdown line. `kind` drives styling in the UI.
  // kind: 'item' | 'subtotal' | 'free' | 'muted' | 'total'
  const line = (label, amount, kind, hint) => ({ label, amount: round2(amount), kind: kind || 'item', hint });

  /**
   * Compute the three routing scenarios.
   *
   * @param {object} i  inputs (merged over DEFAULTS):
   *   bidGBP        the price you're modelling winning at (hammer).
   *   volumeL       bottle volume in litres (e.g. 0.75).
   *   abv           alcohol by volume as a fraction (e.g. 0.677).
   *   origin        'UK' | 'EU' | 'US' | 'Other' — where it was MADE (drives AU tariff).
   *   lotRegion     'UK' | 'EU' — where it currently SITS (drives which carry leg is cheap).
   *   ...plus any rate/fee/FX overrides from DEFAULTS.
   * @returns {{inputs, scenarios, cheapestId}}
   */
  function compute(i) {
    const c = Object.assign({}, DEFAULTS, i);

    const fx = num(c.fxGBPAUD, DEFAULTS.fxGBPAUD);
    const fxEur = num(c.fxEURAUD, DEFAULTS.fxEURAUD);
    const bidGBP = Math.max(0, num(c.bidGBP, 0));
    const volumeL = Math.max(0, num(c.volumeL, 0));
    const abv = clamp(num(c.abv, 0), 0, 1);
    const premiumRate = Math.max(0, num(c.premiumRate, DEFAULTS.premiumRate));
    const insuranceRate = Math.max(0, num(c.insuranceRate, DEFAULTS.insuranceRate));
    const origin = c.origin || 'Other';
    const lotRegion = c.lotRegion === 'EU' ? 'EU' : 'UK';

    // --- Cost base, in AUD ----------------------------------------------------
    const hammerAUD = bidGBP * fx;
    const premiumAUD = hammerAUD * premiumRate;
    const fobAUD = hammerAUD + premiumAUD; // customs value
    const insBaseAUD = c.insuranceBase === 'hammer' ? hammerAUD : fobAUD;
    const insuranceAUD = insBaseAUD * insuranceRate;
    const lpa = volumeL * abv; // litres of pure alcohol

    // Carry-home concession is volumetric: up to this many litres of total
    // beverage per adult, tax-free. Several bottles can share it; only volume
    // beyond it is taxed at the posted rates.
    const allowanceL = Math.max(0, num(c.auConcessionLitres, DEFAULTS.auConcessionLitres));

    // Card surcharge: a payment fee on the auctioneer invoice (not part of the
    // customs value, so it does not inflate tariff/GST). Applies to every route.
    const surchargeRate = Math.max(0, num(c.cardSurchargeRate, DEFAULTS.cardSurchargeRate));
    const surchargeAUD = surchargeRate * (fobAUD + insuranceAUD);
    const surchargeLine = () => surchargeRate > 0
      ? [line('Card surcharge (' + pct(surchargeRate) + ')', surchargeAUD)] : [];

    // =========================================================================
    // 1) DIRECT TO AUSTRALIA — full import stack applies.
    // =========================================================================
    const direct = (function () {
      const freight = Math.max(0, num(c.freightDirectAUD, DEFAULTS.freightDirectAUD));
      const cif = fobAUD + insuranceAUD + freight;
      const excise = lpa * num(c.auExcisePerLPA, DEFAULTS.auExcisePerLPA);

      // Low-value imports (FOB <= $1000) clear as SAC: no customs duty and no
      // formal-entry fees, but alcohol still owes excise + GST (no LVT exemption).
      const aboveThreshold = fobAUD > num(c.auSacThresholdAUD, DEFAULTS.auSacThresholdAUD);
      const tariffApplies = aboveThreshold && origin !== 'UK';
      const tariff = tariffApplies ? num(c.auTariff, DEFAULTS.auTariff) * fobAUD : 0;

      const gst = num(c.auGST, DEFAULTS.auGST) * (cif + excise + tariff);

      let fees = 0;
      const feeLines = [];
      if (aboveThreshold) {
        const dec = num(c.auImportDeclaration, DEFAULTS.auImportDeclaration);
        const bio = num(c.auBiosecurityAir, DEFAULTS.auBiosecurityAir);
        const dutyAndTax = tariff + excise + gst;
        const disbBase = Math.max(num(c.auDisbursementMin, DEFAULTS.auDisbursementMin),
                                  num(c.auDisbursementPct, DEFAULTS.auDisbursementPct) * dutyAndTax);
        const disb = disbBase * (1 + num(c.auGST, DEFAULTS.auGST)); // + GST on the fee
        fees = dec + bio + disb;
        feeLines.push(line('Import declaration', dec, 'item'));
        feeLines.push(line('Biosecurity (air)', bio, 'item'));
        feeLines.push(line('DHL disbursement (incl. GST)', disb, 'item',
          'Greater of $' + DEFAULTS.auDisbursementMin.toFixed(2) + ' or 3% of duty+tax, plus GST'));
      }

      const total = cif + excise + tariff + gst + fees + surchargeAUD;
      const lines = [
        line('Hammer (£' + fmt(bidGBP) + ' @ ' + fx + ')', hammerAUD),
        line('Buyer’s premium (' + pct(premiumRate) + ')', premiumAUD),
        line('Customs value (FOB)', fobAUD, 'subtotal'),
        line('Insurance / breakage (' + pct(insuranceRate) + ')', insuranceAUD),
        ...surchargeLine(),
        line('Freight to AU (DHL)', freight),
        line('CIF', cif, 'subtotal'),
        line('Excise (' + lpa.toFixed(3) + ' LPA × $' + num(c.auExcisePerLPA, DEFAULTS.auExcisePerLPA).toFixed(2) + ')', excise),
        tariffApplies
          ? line('Tariff (5% of FOB)', tariff)
          : line('Tariff (5% of FOB)', 0, 'free', origin === 'UK' ? 'Waived — UK-origin under A-UK FTA' : 'Waived — low-value SAC clearance'),
        line('GST (10% of CIF + excise + tariff)', gst),
        ...feeLines,
      ];
      const note = aboveThreshold
        ? 'Formal import (FOB > $' + DEFAULTS.auSacThresholdAUD + '): declaration + biosecurity + broker fees apply.'
        : 'Self-Assessed Clearance (FOB ≤ $' + DEFAULTS.auSacThresholdAUD + '): no formal-entry fees, but excise + GST still owed.';

      return { id: 'direct', label: 'Direct to Australia', sub: 'Posted to your door', total: round2(total), lines, note };
    })();

    // =========================================================================
    // 2 & 3) CARRY-HOME via a staging region (UK or EU).
    //   Within the 2.25 L passenger concession => ZERO Australian duty/GST/fees.
    //   Cost is purchase + insurance + the in-region leg, PLUS any cross-Brexit
    //   import tax if you stage the lot in the region it does NOT already sit in.
    // =========================================================================
    function carry(region) {
      const domestic = Math.max(0, num(c.inRegionShipGBP, DEFAULTS.inRegionShipGBP)) * fx; // GBP→AUD
      const lines = [
        line('Hammer (£' + fmt(bidGBP) + ' @ ' + fx + ')', hammerAUD),
        line('Buyer’s premium (' + pct(premiumRate) + ')', premiumAUD),
        line('Customs value (FOB)', fobAUD, 'subtotal'),
        line('Insurance / breakage (' + pct(insuranceRate) + ')', insuranceAUD),
        ...surchargeLine(),
      ];
      let importTax = 0;
      let crossBorder = false;

      if (region === lotRegion) {
        // Same region as the lot => domestic (UK) or intra-EU duty-paid move.
        lines.push(line(region === 'EU' ? 'Intra-EU shipping' : 'UK domestic shipping', domestic));
        if (region === 'EU' && c.euExciseBilledIntra) {
          const it = lpa * num(c.euExcisePerLPA_EUR, DEFAULTS.euExcisePerLPA_EUR) * fxEur;
          importTax += it;
          lines.push(line('EU excise', it, 'muted'));
        }
      } else {
        // Crossing the Brexit border => import event into the staging region.
        crossBorder = true;
        lines.push(line('In-region shipping', domestic));
        if (region === 'UK') {
          const ukExcise = lpa * num(c.ukExcisePerLPA_GBP, DEFAULTS.ukExcisePerLPA_GBP) * fx;
          const vatBase = fobAUD + ukExcise + domestic;
          const ukVAT = num(c.ukImportVAT, DEFAULTS.ukImportVAT) * vatBase;
          importTax += ukExcise + ukVAT;
          lines.push(line('UK spirit excise', ukExcise));
          lines.push(line('UK import VAT (' + pct(num(c.ukImportVAT, DEFAULTS.ukImportVAT)) + ')', ukVAT));
        } else {
          const euExcise = lpa * num(c.euExcisePerLPA_EUR, DEFAULTS.euExcisePerLPA_EUR) * fxEur;
          const vatBase = fobAUD + euExcise + domestic;
          const euVAT = num(c.euImportVAT, DEFAULTS.euImportVAT) * vatBase;
          importTax += euExcise + euVAT;
          lines.push(line('EU spirit excise', euExcise));
          lines.push(line('EU import VAT (' + pct(num(c.euImportVAT, DEFAULTS.euImportVAT)) + ')', euVAT));
        }
      }

      const withinAllowance = volumeL <= allowanceL + 1e-9;
      lines.push(line('Australian duty / GST', 0, 'free',
        withinAllowance
          ? 'Within the ' + allowanceL + ' L per-adult allowance — this lot uses ' + volumeL.toFixed(2) + ' L of it'
          : 'Lot volume ' + volumeL.toFixed(2) + ' L exceeds the ' + allowanceL + ' L per-adult allowance'));

      const total = fobAUD + insuranceAUD + surchargeAUD + domestic + importTax;
      const label = region === 'UK' ? 'Via UK, carried home' : 'Via EU, carried home';
      const sub = crossBorder
        ? (region === 'UK' ? 'EU lot → UK import (adds UK VAT)' : 'UK lot → EU import (adds EU VAT)')
        : (region === 'EU' ? 'EU lot stays in the EU — no import event' : 'UK lot stays in the UK — no import event');
      const note = crossBorder
        ? 'Crosses the Brexit border: the import tax here roughly cancels the Australian tax you avoided.'
        : 'Best-case carry route for this lot — stays in its current customs territory.';

      return { id: region.toLowerCase(), label, sub, total: round2(total), lines, note, crossBorder, overAllowance: !withinAllowance };
    }

    const scenarios = [direct, carry('UK'), carry('EU')];
    let cheapestId = scenarios[0].id;
    for (const s of scenarios) if (s.total < scenarios.find((x) => x.id === cheapestId).total) cheapestId = s.id;

    return {
      asOf: c.asOf,
      inputs: {
        bidGBP, volumeL, abv, origin, lotRegion, fx, fxEur, allowanceL,
        hammerAUD: round2(hammerAUD), premiumAUD: round2(premiumAUD),
        fobAUD: round2(fobAUD), insuranceAUD: round2(insuranceAUD), lpa: round2(lpa),
      },
      scenarios,
      cheapestId,
    };
  }

  // ===========================================================================
  // DOMESTIC model — a lot already onshore (e.g. Australian Whisky Auctions).
  // No import duty / excise / tariff / customs fees and no UK/EU routing: the
  // bottle is bought and delivered within Australia. Cost is just hammer +
  // buyer's premium (GST-inclusive) + optional insurance + domestic shipping.
  // ===========================================================================
  const DOMESTIC_DEFAULTS = {
    asOf: '2026-06',
    premiumRate: 0.10,      // buyer's premium, % of hammer — GST-INCLUSIVE (no GST added on top).
    insuranceRate: 0.015,   // optional loss & breakage cover, % of hammer.
    insuranceBase: 'hammer',// 'hammer' or 'fob' (= hammer + premium).
    cardSurchargeRate: 0,   // merchant fee if paying by card; default off (0 for bank transfer).
    shippingAUD: 14,        // domestic shipping for one bottle; editable.
  };

  function computeDomestic(i) {
    const c = Object.assign({}, DOMESTIC_DEFAULTS, i);
    const hammer = Math.max(0, num(c.bidAUD, 0));
    const premiumRate = Math.max(0, num(c.premiumRate, DOMESTIC_DEFAULTS.premiumRate));
    const insuranceRate = Math.max(0, num(c.insuranceRate, DOMESTIC_DEFAULTS.insuranceRate));
    const surchargeRate = Math.max(0, num(c.cardSurchargeRate, DOMESTIC_DEFAULTS.cardSurchargeRate));
    const shipping = Math.max(0, num(c.shippingAUD, DOMESTIC_DEFAULTS.shippingAUD));

    const premium = hammer * premiumRate;
    const fob = hammer + premium;
    const insBase = c.insuranceBase === 'hammer' ? hammer : fob;
    const insurance = insBase * insuranceRate;
    const surcharge = surchargeRate * (fob + insurance);
    const total = fob + insurance + surcharge + shipping;

    const lines = [
      line('Hammer', hammer),
      line('Buyer’s premium (' + pct(premiumRate) + ', incl. GST)', premium),
      line('Subtotal', fob, 'subtotal'),
    ];
    if (insurance > 0) lines.push(line('Loss & breakage (' + pct(insuranceRate) + ')', insurance));
    if (surcharge > 0) lines.push(line('Card surcharge (' + pct(surchargeRate) + ')', surcharge));
    lines.push(line('Domestic shipping', shipping));

    return {
      asOf: c.asOf,
      inputs: { bidAUD: hammer, premium: round2(premium), fob: round2(fob) },
      scenarios: [{
        id: 'domestic', label: 'Delivered to your door', sub: 'NSW, Australia',
        total: round2(total), lines,
        note: 'Domestic resale — no import duty, excise or tariff, and no GST added on the lot (the buyer’s premium is already GST-inclusive).',
      }],
      cheapestId: 'domestic',
    };
  }

  // --- small helpers ---------------------------------------------------------
  function num(v, dflt) {
    const n = typeof v === 'string' ? parseFloat(v) : v;
    return Number.isFinite(n) ? n : dflt;
  }
  function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, n)); }
  function pct(frac) { return round2(frac * 100) + '%'; }
  function fmt(n) { return Number(n).toLocaleString('en-GB', { maximumFractionDigits: 0 }); }

  return { compute, DEFAULTS, computeDomestic, DOMESTIC_DEFAULTS, round2 };
});
