const html = require('choo/html');
const { bytes } = require('../utils');
const assets = require('../../common/assets');
const glyphs = require('./glyphs');

module.exports = function(state, emit) {
  const archive = state.fileInfo;

  /*
   * Structure contract: optionChanged() reads the submit button as
   * event.currentTarget.nextElementSibling, so the <fieldset> has to remain the
   * element immediately before it.
   */
  return html`
    <div class="su-col su-enter">
      <div class="su-glyph su-glyph-warn su-mx-auto su-enter-sm">
        ${glyphs.warning()}
      </div>

      <h1 class="su-title su-mt-8 su-mx-auto su-enter-sm">
        ${state.translate('downloadTitle')}
      </h1>

      <p class="su-lede su-mx-auto su-enter-sm">
        ${state.translate('noStreamsWarning')}
      </p>

      <form class="su-w-full su-mt-8 su-enter-sm" onsubmit=${submit}>
        <div class="su-shell su-w-full">
          <div class="su-core su-card">
            <div class="su-meta">
              <svg class="su-meta-icon">
                <use xlink:href="${assets.get('blue_file.svg')}#icon"></use>
              </svg>
              <div class="su-meta-body">
                <p class="su-meta-name">${archive.name}</p>
                <p class="su-meta-size">${bytes(archive.size)}</p>
              </div>
            </div>
          </div>
        </div>

        <fieldset class="su-choice-group su-mt-5" onchange=${optionChanged}>
          <label class="su-choice">
            <input type="radio" name="gus" id="copy" value="copy" checked />
            <span class="su-choice-text">
              ${state.translate('noStreamsOptionCopy')}
            </span>
          </label>
          <label class="su-choice">
            <input type="radio" name="gus" id="firefox" value="firefox" />
            <span class="su-choice-text">
              ${state.translate('noStreamsOptionFirefox')}
            </span>
          </label>
          <label class="su-choice">
            <input type="radio" name="gus" id="download" value="download" />
            <span class="su-choice-text">
              ${state.translate('noStreamsOptionDownload')}
            </span>
          </label>
        </fieldset>

        <input
          class="su-btn su-mt-6 su-justify-center su-w-full"
          value="${state.translate('copyLinkButton')}"
          title="${state.translate('copyLinkButton')}"
          type="submit"
        />

        <p class="su-lede su-mt-6 su-mx-auto">
          ${state.translate('downloadConfirmDescription')}
        </p>
      </form>
    </div>
  `;

  function optionChanged(event) {
    event.stopPropagation();
    const choice = event.target.value;
    const button = event.currentTarget.nextElementSibling;
    let title = button.title;
    switch (choice) {
      case 'copy':
        title = state.translate('copyLinkButton');
        break;
      case 'firefox':
        title = state.translate('downloadFirefox');
        break;
      case 'download':
        title = state.translate('downloadButtonLabel');
        break;
    }
    button.title = title;
    button.value = title;
  }

  function submit(event) {
    const action = document.querySelector('input[type="radio"]:checked').value;
    switch (action) {
      case 'copy':
        emit('copy', { url: window.location.href });
        document.querySelector('input[type="submit"]').value = state.translate(
          'copiedUrl'
        );
        break;
      case 'firefox':
        window.open(
          'https://www.mozilla.org/firefox/new/?utm_campaign=send-acquisition&utm_medium=referral&utm_source=send.firefox.com'
        );
        break;
      case 'download':
        emit('download');
        break;
    }
    return false;
  }
};
