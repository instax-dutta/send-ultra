const html = require('choo/html');
const raw = require('choo/html/raw');
const assets = require('../../common/assets');
const eyebrow = require('./eyebrow');

module.exports = function intro(state) {
  const notice = state.WEB_UI.MAIN_NOTICE_HTML
    ? html`
        <p class="su-notice su-mb-6">${raw(state.WEB_UI.MAIN_NOTICE_HTML)}</p>
      `
    : '';

  const sponsor = state.WEB_UI.SHOW_THUNDERBIRD_SPONSOR
    ? html`
        <a
          class="su-notice su-notice-link su-mt-6"
          href="https://www.thunderbird.net/"
          rel="noopener noreferrer"
          target="_blank"
        >
          <svg width="18" height="18" class="su-notice-icon">
            <image
              xlink:href="${assets.get('thunderbird-icon.svg')}"
              src="${assets.get('thunderbird-icon.svg')}"
              width="18"
              height="18"
            />
          </svg>
          Sponsored by Thunderbird
        </a>
      `
    : '';

  return html`
    <send-intro class="su-rail-body">
      ${notice}
      <div class="su-panel">
        ${eyebrow(state)}
        <h2 class="su-panel-title su-mt-5">${state.translate('introTitle')}</h2>
        <p class="su-panel-copy">${state.translate('introDescription')}</p>
      </div>
      ${sponsor}
    </send-intro>
  `;
};
