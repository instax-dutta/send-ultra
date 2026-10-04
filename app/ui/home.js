const html = require('choo/html');
const raw = require('choo/html/raw');
const { list } = require('../utils');
const archiveTile = require('./archiveTile');
const modal = require('./modal');
const intro = require('./intro');
const assets = require('../../common/assets');

module.exports = function(state, emit) {
  const archives = state.storage.files
    .filter(archive => !archive.expired)
    .map(archive => archiveTile(state, emit, archive));
  let left = '';
  if (state.uploading) {
    left = archiveTile.uploading(state, emit);
  } else if (state.archive.numFiles > 0) {
    left = archiveTile.wip(state, emit);
  } else {
    left = archiveTile.empty(state, emit);
  }

  if (archives.length > 0 && state.WEB_UI.UPLOADS_LIST_NOTICE_HTML) {
    archives.push(html`
      <p class="su-notice">${raw(state.WEB_UI.UPLOADS_LIST_NOTICE_HTML)}</p>
    `);
  }

  archives.reverse();

  if (archives.length > 0 && state.WEB_UI.SHOW_THUNDERBIRD_SPONSOR) {
    archives.push(html`
      <a
        class="su-notice su-notice-link"
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
    `);
  }

  /*
   * Asymmetrical bento. The upload surface is the anchor at eight columns and
   * two rows; the supporting rail takes the remaining four. Below md every
   * span resets and the grid becomes a single stack with generous gaps.
   */
  const hasArchives = archives.length > 0;
  const right = hasArchives
    ? html`
        <div class="su-rail su-enter su-d3">
          ${list(archives, 'su-rail-list', 'su-rail-item su-enter-sm')}
        </div>
      `
    : html`
        <div class="su-rail su-enter su-d3">${intro(state)}</div>
      `;

  return html`
    <main class="su-main">
      ${state.modal && modal(state, emit)}
      <div class="su-bento">
        <div class="su-cell su-cell-stage su-enter su-d1">${left}</div>
        ${right}
      </div>
    </main>
  `;
};
