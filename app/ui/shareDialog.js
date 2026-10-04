const html = require('choo/html');
const glyphs = require('./glyphs');

module.exports = function(name, url) {
  const dialog = function(state, emit, close) {
    return html`
      <send-share-dialog class="su-dialog">
        <h1 class="su-title">${state.translate('notifyUploadEncryptDone')}</h1>

        <p class="su-lede su-mt-5">
          ${state.translate('shareLinkDescription')}
          <span class="word-break-all">${name}</span>
        </p>

        <input
          type="text"
          id="share-url"
          class="su-input su-mono su-mt-6"
          value="${url}"
          readonly="true"
        />

        <button
          class="su-btn su-mt-6 su-justify-center su-w-full"
          onclick="${share}"
          title="${state.translate('shareLinkButton')}"
        >
          ${state.translate('shareLinkButton')}
          <span class="su-btn-disc" aria-hidden="true">${glyphs.arrow()}</span>
        </button>

        <button
          class="su-link-btn su-mt-4"
          onclick="${close}"
          title="${state.translate('okButton')}"
        >
          ${state.translate('okButton')}
        </button>
      </send-share-dialog>
    `;

    async function share(event) {
      event.stopPropagation();
      try {
        await navigator.share({
          title: state.translate('-send-brand'),
          text: state.translate('shareMessage', { name }),
          url
        });
      } catch (e) {
        if (e.code === e.ABORT_ERR) {
          return;
        }
        console.error(e);
      }
      close();
    }
  };
  dialog.type = 'share';
  return dialog;
};
