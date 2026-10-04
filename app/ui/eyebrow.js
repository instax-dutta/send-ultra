const html = require('choo/html');

/*
 * Brand eyebrow.
 *
 * state.brand comes from CUSTOM_TITLE, which an operator can legitimately set
 * to an empty string. header.js has always had a fallback chain for that case;
 * this keeps every other eyebrow consistent with it instead of rendering an
 * empty pill next to a populated header.
 */
function brand(state) {
  return state.brand || state.WEB_UI_BRAND || state.translate('title');
}

module.exports = function eyebrow(state, className = '') {
  return html`
    <span class="su-eyebrow ${className}">
      <span class="su-eyebrow-dot"></span>
      ${brand(state)}
    </span>
  `;
};

module.exports.brand = brand;
