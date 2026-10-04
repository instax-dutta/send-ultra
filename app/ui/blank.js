const html = require('choo/html');

/*
 * Placeholder layout used by the Android shell while it swaps routes. It has no
 * chrome of its own, so it only reserves the working area that su-main expects
 * rather than painting a legacy white panel behind the field orbs.
 */
module.exports = function() {
  return html`
    <main class="su-main">
      <div class="su-bento" aria-hidden="true">
        <div class="su-cell su-cell-stage"></div>
        <div class="su-rail"></div>
      </div>
    </main>
  `;
};
