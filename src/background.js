/*
 * background.js — MV3 service worker.
 *
 * Sole job: fetch live FX from Frankfurter (ECB data, no API key) on request from
 * the content script. Doing the fetch here rather than in the content script avoids
 * the listing page's connect-src CSP and keeps host permissions scoped to one domain.
 */
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === 'WA_FETCH_FX') {
    fetchFX().then(sendResponse).catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true; // keep the message channel open for the async response
  }
});

async function fetchFX() {
  // GBP base → AUD and EUR. EUR→AUD is derived (AUD/EUR) for the EU-side maths.
  const res = await fetch('https://api.frankfurter.app/latest?from=GBP&to=AUD,EUR');
  if (!res.ok) throw new Error('FX HTTP ' + res.status);
  const data = await res.json();
  const gbpAud = data && data.rates && data.rates.AUD;
  const gbpEur = data && data.rates && data.rates.EUR;
  if (!gbpAud) throw new Error('FX response missing AUD');
  return {
    ok: true,
    fxGBPAUD: round4(gbpAud),
    fxEURAUD: gbpEur ? round4(gbpAud / gbpEur) : null,
    date: data.date,
  };
}

function round4(n) { return Math.round(n * 1e4) / 1e4; }
