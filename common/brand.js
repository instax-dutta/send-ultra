/*
 * The product name is a deployment setting (CUSTOM_TITLE), not a translatable
 * string.
 *
 * Every shipped locale carries a hardcoded `-send-brand` and
 * `-send-short-brand`, and those two terms feed most of the user-visible copy.
 * Left alone, a visitor whose browser asks for anything other than en-US reads
 * the old name in every Fluent-sourced sentence while the wordmark in the
 * header shows the configured one, because the wordmark comes from config and
 * the copy comes from the locale bundle.
 *
 * Rewriting the terms as each bundle is built keeps one source of truth: an
 * operator changes CUSTOM_TITLE and every language follows. The shipped .ftl
 * files are left untouched so the translations stay reviewable and diffable.
 *
 * Shared by server/locale.js and app/locale.js so the two renderers cannot
 * drift on what the brand string is.
 */

/* `Send Ultra` -> `Send`: the short form is the first word of the brand. */
function shortBrandOf(brand) {
  const first = String(brand)
    .trim()
    .split(/\s+/)[0];
  return first || brand;
}

/*
 * Sets both terms, inserting them when a locale does not define them.
 *
 * Seven shipped locales never declared `-send-brand`, which means every
 * sentence referencing it was rendering a Fluent fallback rather than a name.
 * Appending the terms is safe: Fluent resolves a term wherever it appears.
 */
function applyBrand(ftl, brand) {
  if (!brand) {
    return ftl;
  }
  const wanted = {
    '-send-brand': String(brand).trim(),
    '-send-short-brand': shortBrandOf(brand)
  };

  let out = ftl;
  const missing = [];

  for (const [term, value] of Object.entries(wanted)) {
    /*
     * Anchored, global, and with a lookahead so `-send-brand` cannot match a
     * longer term that merely starts with it, nor can a stale second definition
     * survive while the first is rewritten.
     */
    const pattern = new RegExp(`^${term}(?![-\\w])\\s*=.*$`, 'gm');
    if (pattern.test(out)) {
      out = out.replace(pattern, `${term} = ${value}`);
    } else {
      missing.push(`${term} = ${value}`);
    }
  }

  if (missing.length) {
    out = `${out.replace(/\s*$/, '')}\n${missing.join('\n')}\n`;
  }

  return out;
}

module.exports = { applyBrand, shortBrandOf };
