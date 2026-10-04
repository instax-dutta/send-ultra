const fs = require('fs');
const path = require('path');
const { FluentBundle, FluentResource } = require('@fluent/bundle');
const localesPath = path.resolve(__dirname, '../public/locales');
const locales = fs.readdirSync(localesPath);
const { applyBrand } = require('../common/brand');

/* The deployment setting. Read once; config is immutable after startup. */
let brand = '';

function makeBundle(locale, source) {
  const bundle = new FluentBundle(locale, { useIsolating: false });
  bundle.addResource(new FluentResource(applyBrand(source, brand)));
  return [locale, bundle];
}

let bundles = new Map();

/*
 * Rebuilt when the brand changes. The server renders the first paint of every
 * page, so a stale bundle here is visible to everyone.
 */
function build() {
  bundles = new Map(
    locales.map(locale =>
      makeBundle(
        locale,
        fs.readFileSync(path.resolve(localesPath, locale, 'send.ftl'), 'utf8')
      )
    )
  );
}

build();

module.exports = function getTranslator(locale) {
  return function(id, data) {
    const defaultBundle = bundles.get('en-US');
    const bundle = bundles.get(locale) || defaultBundle;
    if (bundle.hasMessage(id)) {
      return bundle.formatPattern(bundle.getMessage(id).value, data);
    }
    return defaultBundle.formatPattern(
      defaultBundle.getMessage(id).value,
      data
    );
  };
};

module.exports.setBrand = function setBrand(value) {
  const next = String(value || '').trim();
  if (next && next !== brand) {
    brand = next;
    build();
  }
};

/* Exported for the verifier that asserts the copy follows the setting. */
module.exports._internals = {
  localesPath,
  list: () => [...bundles.keys()]
};
