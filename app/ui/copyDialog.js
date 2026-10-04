const html = require('choo/html');
const { copyToClipboard } = require('../utils');
const glyphs = require('./glyphs');
const qr = require('./qr');

module.exports = function(name, url) {
  const dialog = function(state, emit, close) {
    return html`
      <send-copy-dialog class="su-dialog">
        <h1 class="su-title">${state.translate('notifyUploadEncryptDone')}</h1>

        <p class="su-lede su-mt-5">
          ${state.translate('copyLinkDescription')}
          <span class="word-break-all">${name}</span>
        </p>

        <div class="su-share-row su-mt-6">
          <input
            type="text"
            id="share-url"
            class="su-input su-mono"
            value="${url}"
            readonly="true"
          />
          <button
            id="qr-btn"
            class="su-qr w-16"
            onclick="${toggleQR}"
            title="QR code"
          >
            ${qr(url)}
          </button>
        </div>

        <button
          class="su-btn su-mt-6 su-justify-center su-w-full"
          onclick="${copy}"
          title="${state.translate('copyLinkButton')}"
        >
          ${state.translate('copyLinkButton')}
          <span class="su-btn-disc" aria-hidden="true">${glyphs.arrow()}</span>
        </button>

        <button
          class="su-link-btn su-mt-4"
          onclick="${close}"
          title="${state.translate('okButton')}"
        >
          ${state.translate('okButton')}
        </button>
      </send-copy-dialog>
    `;

    /*
     * Expands the QR and hides the link field, and back again.
     *
     * Written as toggles rather than the previous replace() pairs. replace()
     * throws the token away silently when it is not already on the element, so
     * the pair stopped working the moment the field lost its explicit `block`
     * class during the restyle, and the button looked inert.
     */
    function toggleQR(event) {
      event.stopPropagation();
      const shareUrl = document.getElementById('share-url');
      const qrBtn = document.getElementById('qr-btn');
      const expanded = shareUrl.classList.toggle('su-is-hidden');
      qrBtn.classList.toggle('w-48', expanded);
      qrBtn.classList.toggle('w-16', !expanded);
    }

    function copy(event) {
      event.stopPropagation();
      copyToClipboard(url);
      event.target.textContent = state.translate('copiedUrl');
      setTimeout(close, 1000);
    }
  };
  dialog.type = 'copy';
  return dialog;
};
