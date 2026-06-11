# Whisky Auction Landed-Cost Calculator (AU)

A Chrome extension (Manifest V3) that shows the estimated **landed cost in AUD** for a
buyer based in NSW, Australia, on whisky auction listings. It's **multi-site**: each
auction site gets the cost model that fits where the lot physically sits.

## Supported sites

| Site | Model | What it shows |
|---|---|---|
| **whiskyauctioneer.com** | `import` (GBP) | Full import-to-AU stack across **three routes** (Direct / via UK / via EU), highlighting the cheapest — the routing arbitrage below. |
| **australianwhiskyauctions.com.au** | `domestic` (AUD) | The lot is already onshore, so **one delivered cost**: hammer + buyer's premium (GST-inclusive) + optional insurance + domestic shipping. No import duty/excise/tariff, no routing. |

Adding a site is a parser in `src/parser.js` + an entry in `src/sites.js` (see
[Adding a site](#adding-a-site)).

---

## Whisky Auctioneer — the routing arbitrage

The whole point on the import side is the **routing arbitrage**: you can often avoid the
Australian import tax by hand-carrying the bottle home under the 2.25 L-per-adult
traveller concession (volumetric — several small bottles can share it) — but *only* if
you stage it in the customs territory the lot already sits in.
Cross the Brexit border in either direction and the import tax you pick up roughly cancels
the saving.

### The three routes

| Route | When it wins | Why |
|---|---|---|
| **Direct to Australia** | never the floor, but simplest | Full AU import stack: FOB → CIF → excise + tariff + GST + DHL/govt fees. |
| **Via UK, carried home** | **UK lots** | UK duty/VAT already in the hammer → cheap domestic post, then carry home (no AU tax). For an *EU* lot it's a post-Brexit UK import (+20% VAT) — no saving. |
| **Via EU, carried home** | **EU lots** | Intra-EU duty-paid move, no import event → cheap, then carry home (no AU tax). For a *UK* lot it's an EU import (+22% VAT) — no saving. |

> **Rule the tool surfaces:** carry it back via whichever region the lot already sits in.
> EU lot → route through the EU. UK lot → route through the UK.

## Install (load unpacked)

1. `chrome://extensions`
2. Toggle **Developer mode** (top-right).
3. **Load unpacked** → select this folder.
4. Open any supported lot page (Whisky Auctioneer or Australian Whisky Auctions). A 🥃
   panel appears bottom-right (drag the header to move it, `—` to collapse to a button).

No build step — it's plain JS loaded directly.

## Using it

- The panel auto-reads **current bid, volume, ABV, year, lot region (UK/EU badge)** and
  guesses **origin** from the name. Every field is **editable** — parsing is best-effort and
  never silently wrong; a miss just leaves a blank for you to fill.
- Type a **"your max bid"** to model winning at a chosen price.
- **Origin** drives the AU tariff (UK-origin is waived under the A-UK FTA). **Lot region**
  drives which carry leg is cheap. These are independent — a UK-origin Scotch can sit in an
  EU warehouse.
- Expand any route to see the full line-item breakdown. Open **Rates & fees** to edit every
  assumption (persisted across sessions).

## Cost methodology (AU import)

- **FOB / customs value** = hammer + buyer's premium (commission is part of the cost base).
- **CIF** = FOB + insurance (loss & breakage) + freight.
- **Excise** = litres of pure alcohol (`volume × ABV`) × rate. Per-bottle, near-flat — minor
  on a pricey lot, significant on a cheap high-proof one. Owed even on low-value imports.
- **Tariff** = 5% of FOB. Waived for **UK-origin** spirits (A-UK FTA). Applies to US/bourbon
  and other non-UK origins even when the lot is UK/EU-located. Also not collected on
  low-value (FOB ≤ A$1,000) SAC clearances.
- **GST** = 10% × (CIF + excise + tariff) — you pay tax on the tax.
- **Govt/broker fees** only above **FOB A$1,000**: import declaration ~$50 + biosecurity
  (air) ~$45 + DHL disbursement (greater of $23.10 or 3% of duty+tax, + GST). At/below
  $1,000 it clears as a Self-Assessed Clearance (no formal-entry fees) but excise + GST still
  apply (alcohol gets no low-value exemption).
- **Carry-home routes** assume the lot is carried within the 2.25 L-per-adult **volumetric**
  concession → **zero AU duty/GST/fees**; cost is purchase + insurance + the in-region
  shipping leg, plus any cross-Brexit import tax if you stage the lot in the wrong region.
  The allowance is by total volume (several bottles can share it) and is editable for extra
  travellers; a lot whose own volume exceeds it falls back to posted (Direct) treatment.

## Rates & assumptions (date-stamped — they drift; all editable)

| Input | Default | Source / note |
|---|---|---|
| AU spirits excise | **A$107.99 / LPA** | ATO, effective 2 Feb 2026. Re-indexes every Feb & Aug. ✅ confirmed. |
| AU GST / tariff / SAC threshold | 10% / 5% / A$1,000 | Standard. |
| Passenger concession | 2.25 L / adult 18+ | Volumetric (total beverage volume), no value cap. Editable — raise for extra adult travellers. |
| **Buyer's premium** | **12.5%** | Whisky Auctioneer published schedule (ex-VAT). **The brief assumed ~11% — updated to the confirmed 12.5%.** |
| Loss & breakage cover | **4%** of hammer | Confirmed 4% of hammer price (brief assumed ~2%). |
| **Card surcharge** | **0%** (off) | WA charges **3.5% on non-UK/EEA cards** — set this to `3.5` if paying by card, leave `0` for bank transfer. |
| UK spirit excise (>22%) | £33.99 / LPA | Feb 2026; verify on gov.uk. Only bites when staging an EU lot in the UK. |
| UK import VAT | 20% | Post-Brexit import of an EU lot into the UK. |
| EU excise / VAT | €10 / LPA, 22% | EU excise rarely billed on a single duty-paid bottle; VAT only bites on a UK→EU import. |
| FX GBP→AUD | 1.875 (live) | Fetched from [Frankfurter](https://www.frankfurter.app) (ECB daily). The single biggest lever — click **live** to refresh, or override. |
| Freight to AU | A$80 | DHL to your door (editable estimate). |
| In-region ship | **£14** | The in-region leg to your staging address, in GBP (intra-EU = £14); converted at the FX rate. |

> **Estimate only.** Duty & excise rates change. Carry-home figures assume the bottle is
> carried within the **2.25 L per-adult alcohol allowance, declared truthfully** on arrival.
> The allowance is by total volume — several bottles can share it — and volume beyond it is
> taxed at the posted (Direct) rates.

## Australian Whisky Auctions — domestic (rates editable)

The lot is already in Australia, so the model is just the delivered cost. Defaults
([source](https://www.australianwhiskyauctions.com.au/how-to-buy)):

| Input | Default | Note |
|---|---|---|
| Buyer's premium | **10%** | Of hammer, **GST-inclusive** — no GST added on top. |
| Loss & breakage | **1.5%** | Optional cover, % of hammer. Set 0 to skip. |
| Card surcharge | 0% | Merchant fee if paying by card; 0 for bank transfer. |
| Domestic shipping | **A$14** | One bottle; editable for larger consignments. |

No import duty, excise, tariff, customs/broker fees, or routing.

## Validation

Import engine pinned to the brief's worked example
(Weller 2016, EU lot, bourbon, £800, 11% premium): **Direct ≈ A$2,228 · Via UK ≈ A$2,100 ·
Via EU ≈ A$1,723 (cheapest)**. Both parsers are validated against the **real** rendered DOM
of each site.

```bash
node test/calc.test.mjs     # import + domestic models, worked example, allowance, SAC threshold
node test/parser.test.mjs   # both sites: bid/volume/ABV/origin extraction
node tools/make-icons.mjs   # regenerate the PNG icons
```

## Layout

```
manifest.json          MV3 manifest (content scripts for both sites + FX service worker)
src/calc.js            cost engine — compute() (import) + computeDomestic(); a Node module too
src/parser.js          per-site listing extraction (WA.parsers.{whiskyauctioneer, awa})
src/sites.js           hostname → { kind, currency, parser } registry + pickSite()
src/content.js         injected shadow-DOM panel + UI wiring (site-aware)
src/background.js      service worker — live FX fetch (avoids page CSP)
test/                  headless validation of the engines + parsers
preview/index.html     dev harness: Whisky Auctioneer (import) mock listing
preview/awa.html       dev harness: Australian Whisky Auctions (domestic) mock listing
tools/make-icons.mjs   generates icons/icon{16,48,128}.png
```

### Adding a site

1. Write a parser function in `src/parser.js` returning
   `{ title, bid, volumeL, abv, origin, currency, isListing, … }` and add it to
   `WA.parsers`.
2. Add a `src/sites.js` entry mapping the hostname to `{ kind, currency, parse }`
   (`kind` is `import` or `domestic`).
3. Add the host to `content_scripts.matches` in `manifest.json`.

### Previewing without Chrome

`preview/index.html` (import) and `preview/awa.html` (domestic) mount the real content
script over a fake listing with stubbed `chrome.*` APIs. Serve the repo root
(`python3 -m http.server 8731`) and open the file.
