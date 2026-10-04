const html = require('choo/html');
const glyphs = require('./glyphs');
const eyebrow = require('./eyebrow');

module.exports = function(state, emit) {
  const fileInfo = state.fileInfo;
  const invalid = fileInfo.password === null;

  const div = html`
    <div class="su-col su-enter">
      <div class="su-glyph su-mx-auto su-enter-sm">${glyphs.lock()}</div>

      ${eyebrow(state, 'su-mt-8 su-mx-auto su-enter-sm')}

      <h1 class="su-title su-mt-5 su-mx-auto su-enter-sm">
        ${state.translate('downloadTitle')}
      </h1>

      <p class="su-lede su-mx-auto su-enter-sm">
        ${state.translate('downloadDescription')}
      </p>

      <form class="su-split su-mt-8" onsubmit="${checkPassword}" data-no-csrf>
        <input
          id="autocomplete-decoy"
          class="su-visually-hidden"
          type="password"
          value="lol"
        />
        <input
          id="password-input"
          class="su-input ${invalid ? 'su-input-rejected' : ''}"
          maxlength="4096"
          autocomplete="off"
          placeholder="${state.translate('unlockInputPlaceholder')}"
          aria-invalid="${invalid ? 'true' : 'false'}"
          aria-describedby="password-error"
          oninput="${inputChanged}"
          type="password"
        />
        <button
          type="submit"
          id="password-btn"
          class="su-btn"
          title="${state.translate('unlockButtonLabel')}"
        >
          ${state.translate('unlockButtonLabel')}
          <span class="su-btn-disc" aria-hidden="true">
            ${glyphs.arrow()}
          </span>
        </button>
      </form>

      <label
        id="password-error"
        class="su-error ${invalid ? '' : 'su-error-off'}"
        for="password-input"
      >
        ${state.translate('passwordTryAgain')}
      </label>
    </div>
  `;

  if (!(div instanceof String)) {
    setTimeout(() => document.getElementById('password-input').focus());
  }

  function inputChanged(event) {
    event.stopPropagation();
    event.preventDefault();
    const label = document.getElementById('password-error');
    const input = document.getElementById('password-input');
    label.classList.add('su-error-off');
    input.classList.remove('su-input-rejected');
    input.setAttribute('aria-invalid', 'false');
  }

  function checkPassword(event) {
    event.stopPropagation();
    event.preventDefault();
    const el = document.getElementById('password-input');
    const password = el.value;
    if (password.length > 0) {
      document.getElementById('password-btn').disabled = true;
      // Strip any url parameters between fileId and secretKey
      const fileInfoUrl = window.location.href.replace(/\?.+#/, '#');
      state.fileInfo.url = fileInfoUrl;
      state.fileInfo.password = password;
      emit('getMetadata');
    }
    return false;
  }

  return div;
};
