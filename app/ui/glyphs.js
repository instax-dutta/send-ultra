const html = require('choo/html');

/*
 * Inline glyphs for the receiver and terminal states.
 *
 * These replace three legacy illustrations that totalled roughly 70KB and were
 * drawn for the old light panel. Each is a 24x24 stroke glyph that inherits
 * currentColor, so it retints with the state it sits in instead of shipping a
 * separate coloured asset per outcome.
 */

function wrap(children) {
  return html`
    <svg
      class="su-glyph-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      ${children}
    </svg>
  `;
}

function disc(inner) {
  return html`
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      ${inner}
    </svg>
  `;
}

function stroke(inner, width = 1.4) {
  return html`
    <path
      d="${inner}"
      stroke="currentColor"
      stroke-width="${width}"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
  `;
}

module.exports = {
  /*
   * Trailing icons inside the pill buttons. One module so the shared stroke
   * treatment cannot drift, while still letting each button keep the direction
   * that matches what it does.
   */
  arrow() {
    return disc(stroke('M3 11L11 3M11 3H4.5M11 3V9.5'));
  },

  upload() {
    return disc(stroke('M7 12V3M7 3L3.5 6.5M7 3l3.5 3.5'));
  },

  downloadDisc() {
    return disc(stroke('M7 2.5v9M3.5 8L7 11.5 10.5 8'));
  },

  /* Transfer received and decrypted. */
  check() {
    return wrap(
      html`
        <path d="M4.5 12.5l5 5 10-11" />
      `
    );
  },

  /* Something failed on our side. */
  alert() {
    return wrap(html`
      <path d="M12 4.2L21 19.5H3z" /><path d="M12 10v4" />
      <path d="M12 17h0.01" />
    `);
  },

  /* The link is past its expiry. */
  expired() {
    return wrap(html`
      <circle cx="12" cy="12" r="8.5" /><path d="M12 7v5.2l3.2 2" />
      <path d="M6.1 6.1l11.8 11.8" />
    `);
  },

  /* Unlock prompt. */
  lock() {
    return wrap(html`
      <rect x="5" y="10.5" width="14" height="9.5" rx="2.2" />
      <path d="M8.25 10.5V8a3.75 3.75 0 017.5 0v2.5" />
    `);
  },

  /* Offered on the download button. */
  download() {
    return wrap(
      html`
        <path d="M12 3.5v11.5M7.5 11l4.5 4.5 4.5-4.5M4.5 20h15" />
      `
    );
  },

  /* Large-file fallback warning. */
  warning() {
    return wrap(html`
      <path d="M12 4.2L21 19.5H3z" /><path d="M12 10v4" />
      <path d="M12 17h0.01" />
    `);
  }
};
