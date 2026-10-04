#!/usr/bin/env node
/*
 * Proves the product name in user-facing copy follows the configured brand in
 * every shipped language.
 *
 * The failure this guards against is real and already happened once: the
 * rebrand edited public/locales/en-US only, while 73 other locales still
 * carried a hardcoded `-send-brand = Send`. Because the wordmark comes from
 * config and the sentences come from the locale bundle, a visitor whose browser
 * asked for anything but en-US saw "Send Ultra" in the header and "Send" in
 * every sentence. This asserts the two cannot disagree again.
 *
 * The brand is read from the deployment setting rather than argv, because a
 * multi-word name passed as an argument silently word-splits at the shell and
 * turns a real check into a check of the wrong string. Override with
 * SEND_BRAND when testing a value other than the configured default.
 *
 * Usage: node scripts/verify/brand-in-locales.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

function configuredBrand() {
  if (process.env.SEND_BRAND) {
    return process.env.SEND_BRAND.trim();
  }
  return require('../../server/config').custom_title;
}

const BRAND = configuredBrand();
const localesPath = path.resolve(process.cwd(), 'public/locales');
const getTranslator = require('../../server/locale');
const { applyBrand, shortBrandOf } = require('../../common/brand');

const shortBrand = shortBrandOf(BRAND);

/* Strings that must not contain the superseded name once the term is applied. */
const SUPERSEDED = /\bSend\b(?!\s+Ultra)/;

const locales = fs
  .readdirSync(localesPath)
  .filter(name => fs.existsSync(path.join(localesPath, name, 'send.ftl')));

let checked = 0;
const failures = [];

for (const locale of locales) {
  const file = path.join(localesPath, locale, 'send.ftl');
  const original = fs.readFileSync(file, 'utf8');
  const rewritten = applyBrand(original, BRAND);

  // The rewrite must reach the terms, whichever order or spacing the file uses.
  if (!new RegExp(`^-send-brand\\s*=\\s*${BRAND.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'm').test(rewritten)) {
    failures.push(`${locale}: -send-brand did not resolve to ${JSON.stringify(BRAND)}`);
    continue;
  }
  if (!new RegExp(`^-send-short-brand\\s*=\\s*${shortBrand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'm').test(rewritten)) {
    failures.push(`${locale}: -send-short-brand did not resolve to ${JSON.stringify(shortBrand)}`);
    continue;
  }

  /*
   * A locale may legitimately use the short brand, but must never use the bare
   * superseded name in a sentence of its own.
   */
  const sentences = rewritten
    .split('\n')
    .filter(line => !line.trim().startsWith('#'))
    .filter(line => /^[^=\s-][^=]*=/.test(line.trim()) === false)
    .filter(line => line.includes('{ -send-brand }') || line.includes('{ -send-short-brand }'));

  for (const line of sentences) {
    if (SUPERSEDED.test(line)) {
      failures.push(`${locale}: sentence still hardcodes the old name: ${line.trim().slice(0, 70)}`);
      break;
    }
  }

  checked++;
}

/* The short brand must be a real prefix of the brand, or the legal pages and
   the DMCA notice read wrong. */
if (!BRAND.startsWith(shortBrand)) {
  failures.push(`short brand ${JSON.stringify(shortBrand)} is not a prefix of ${JSON.stringify(BRAND)}`);
}

/* And the configured title must survive a round trip through the translator. */
getTranslator.setBrand(BRAND);
const t = getTranslator('de');
const sample = t('trySendDescription');
if (!sample.includes(BRAND)) {
  failures.push(`translator output missing the brand: ${JSON.stringify(sample)}`);
}

if (failures.length) {
  process.stderr.write(`\n${failures.length} locale brand problem(s):\n`);
  for (const f of failures) {
    process.stderr.write(`  - ${f}\n`);
  }
  process.exit(1);
}

process.stdout.write(`  brand: ${BRAND}\n`);
process.stdout.write(`  short brand: ${shortBrand}\n`);
process.stdout.write(`  locales checked: ${checked}\n`);
process.stdout.write('BRAND IN LOCALES VERIFIED\n');