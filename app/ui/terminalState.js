const html = require('choo/html');
const eyebrow = require('./eyebrow');
const glyphs = require('./glyphs');

/*
 * One shell for the terminal pages.
 *
 * error, notFound and downloadCompleted differed only in glyph, tone and copy,
 * so the layout, the eyebrow and the call to action live here instead of being
 * restated three times and drifting apart. Each caller passes its own content;
 * nothing about the outcome is decided in this file.
 */
module.exports = function terminalState(state, opts) {
  const {
    id = '',
    overlay = '',
    glyph,
    tone = '',
    brandEyebrow = false,
    title,
    description = '',
    action = null,
    children = ''
  } = opts;

  /*
   * The card is centred, so the inline eyebrow and heading follow from
   * text-align alone. The glyph and the measure-capped description are block
   * boxes, so they still need auto margins to sit on the centre line.
   */
  const body = html`
    <div class="su-glyph ${tone} su-mx-auto su-enter-sm">${glyph}</div>

    ${brandEyebrow ? eyebrow(state, 'su-mt-8 su-enter-sm') : ''}

    <h1 class="su-title su-mt-5 su-enter-sm">${title}</h1>

    ${description
      ? html`
          <p class="su-lede su-mx-auto su-enter-sm">${description}</p>
        `
      : ''}
    ${children}
    ${action
      ? html`
          <a
            class="su-btn su-mt-8 su-enter-sm"
            href="${action.href}"
            role="button"
          >
            ${action.label}
            <span class="su-btn-disc" aria-hidden="true"
              >${glyphs.arrow()}</span
            >
          </a>
        `
      : ''}
  `;

  /*
   * The card is wrapped rather than given an interpolated id attribute, because
   * the two shell paths must produce byte-identical markup apart from the id.
   */
  const card = id
    ? html`
        <div id="${id}" class="su-core su-card su-text-center">${body}</div>
      `
    : html`
        <div class="su-core su-card su-text-center">${body}</div>
      `;

  return html`
    <main class="su-main">
      ${overlay}
      <div class="su-col">
        <div class="su-shell su-w-full su-enter">${card}</div>
      </div>
    </main>
  `;
};
