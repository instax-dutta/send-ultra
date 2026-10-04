const html = require('choo/html');
const modal = require('./modal');
const assets = require('../../common/assets');
const glyphs = require('./glyphs');
const eyebrow = require('./eyebrow');

module.exports = function(state, emit) {
  const outdated = state.params.reason === 'outdated';

  const url = outdated
    ? 'https://support.mozilla.org/kb/update-firefox-latest-version'
    : 'https://www.mozilla.org/firefox/new/?utm_campaign=send-acquisition&utm_medium=referral&utm_source=send.firefox.com';

  const button = outdated
    ? state.translate('updateFirefox')
    : state.translate('downloadFirefox');

  return html`
    <main class="su-main">
      ${state.modal && modal(state, emit)}
      <div class="su-col">
        <div class="su-shell su-w-full su-enter">
          <div class="su-core su-card su-text-center">
            <div class="su-glyph su-glyph-warn su-mx-auto su-enter-sm">
              ${glyphs.warning()}
            </div>

            ${eyebrow(state, 'su-mt-8 su-mx-auto su-enter-sm')}

            <h1 class="su-title su-mt-5 su-enter-sm">
              ${state.translate('notSupportedHeader')}
            </h1>

            <p class="su-lede su-mx-auto su-enter-sm">
              ${outdated
                ? state.translate('notSupportedOutdatedDetail')
                : state.translate('notSupportedDescription')}
            </p>

            ${outdated
              ? ''
              : html`
                  <p class="su-mt-5 su-enter-sm">
                    <a
                      class="su-ghost"
                      href="https://github.com/timvisee/send/blob/master/docs/faq.md#why-is-my-browser-not-supported"
                      rel="noopener noreferrer"
                      target="_blank"
                    >
                      ${state.translate('notSupportedLink')}
                      <span class="su-btn-disc" aria-hidden="true">
                        <svg
                          width="12"
                          height="12"
                          viewBox="0 0 14 14"
                          fill="none"
                        >
                          <path
                            d="M5 9L9 5M9 5H5.5M9 5V8.5"
                            stroke="currentColor"
                            stroke-width="1.4"
                            stroke-linecap="round"
                            stroke-linejoin="round"
                          />
                        </svg>
                      </span>
                    </a>
                  </p>
                `}

            <a
              class="su-btn su-mt-8 su-enter-sm"
              href="${url}"
              rel="noopener noreferrer"
              target="_blank"
            >
              ${button}
              <span class="su-btn-disc" aria-hidden="true">
                <svg width="18" height="18" viewBox="0 0 24 24">
                  <image
                    xlink:href="${assets.get('firefox_logo-only.svg')}"
                    src="${assets.get('firefox_logo-only.svg')}"
                    width="18"
                    height="18"
                  />
                </svg>
              </span>
            </a>
          </div>
        </div>
      </div>
    </main>
  `;
};
