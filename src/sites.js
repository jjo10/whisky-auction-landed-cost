/*
 * sites.js — registry mapping a hostname to its parser + cost model.
 *
 * `kind` selects the cost engine and the panel layout:
 *   'import'   — lot is overseas (GBP), import-to-AU stack + UK/EU carry routing.
 *   'domestic' — lot is already onshore (AUD), simple delivered cost, no routing.
 *
 * To add a site: write a parser in parser.js and add an entry here.
 */
(function (root) {
  'use strict';
  root.WA = root.WA || {};

  root.WA.sites = {
    'whiskyauctioneer.com': {
      id: 'whiskyauctioneer', name: 'Whisky Auctioneer', kind: 'import', currency: 'GBP',
      parse: () => root.WA.parsers.whiskyauctioneer(),
    },
    'australianwhiskyauctions.com.au': {
      id: 'awa', name: 'Australian Whisky Auctions', kind: 'domestic', currency: 'AUD',
      parse: () => root.WA.parsers.awa(),
    },
  };

  // Match exact host or any subdomain of a registered host (e.g. www.*).
  root.WA.pickSite = function (hostname) {
    hostname = (hostname || '').toLowerCase();
    for (const host in root.WA.sites) {
      if (hostname === host || hostname.endsWith('.' + host)) return root.WA.sites[host];
    }
    return null;
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
