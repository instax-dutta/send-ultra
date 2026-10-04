import { FluentBundle, FluentResource } from '@fluent/bundle';
import { applyBrand, shortBrandOf } from '../common/brand';

function makeBundle(locale, ftl, brand) {
  const bundle = new FluentBundle(locale, { useIsolating: false });
  bundle.addResource(new FluentResource(applyBrand(ftl, brand)));
  return bundle;
}

/*
 * `brand` is threaded through rather than read from a global because the
 * configured title is injected as a webpack DefinePlugin constant, which is
 * only available in modules that main.js passes it to.
 */
export async function getTranslator(locale, brand = '') {
  const bundles = [];
  const { default: en } = await import('../public/locales/en-US/send.ftl');
  if (locale !== 'en-US') {
    const { default: ftl } = await import(
      `../public/locales/${locale}/send.ftl`
    );
    bundles.push(makeBundle(locale, ftl, brand));
  }
  bundles.push(makeBundle('en-US', en, brand));
  return function(id, data) {
    for (let bundle of bundles) {
      if (bundle.hasMessage(id)) {
        return bundle.formatPattern(bundle.getMessage(id).value, data);
      }
    }
  };
}
