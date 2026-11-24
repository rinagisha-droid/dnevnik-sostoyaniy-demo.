'use strict';
/*
 * Storefront display only. Flip "paymentsEnabled" to true ONLY after:
 * 1. Prodamus links are enabled and final totals checked on buyer's side;
 * 2. paid purchase -> signed callback -> account claim is verified for real;
 * 3. refunds, legal documents, privacy and hosting constraints are resolved.
 *
 * Never trust this file to grant access. Supabase validates real orders.
 * Regular price links for 2027 are not configured: no prices auto-switch to
 * pre-sale URLs after the promotion ends.
 */
window.DiaryCheckoutConfiguration = Object.freeze({
  paymentsEnabled: false,
  presaleStart: '2026-12-15T00:00:00+03:00',
  presaleEndExclusive: '2027-01-01T00:00:00+03:00',
  presaleSixMonths: 'https://payform.ru/5sd6jay/',
  presaleTwelveMonths: 'https://payform.ru/36d6jrX/'
});
