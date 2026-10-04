const html = require('choo/html');
const version = require('../../package.json').version;
const { browserName } = require('../utils');
const glyphs = require('./glyphs');

module.exports = function() {
  return function(state, emit, close) {
    const surveyUrl = `${
      state.PREFS.surveyUrl
    }?ver=${version}&browser=${browserName()}&anon=${
      state.user.loggedIn
    }&active_count=${state.storage.files.length}`;
    return html`
      <send-survey-dialog class="su-dialog">
        <h1 class="su-title">Tell us what you think.</h1>

        <p class="su-lede su-mt-5">
          Love Send Ultra? Take a quick survey to let us know how we can make it
          better.
        </p>

        <a
          class="su-btn su-mt-8 su-justify-center su-w-full"
          onclick="${() => emit('closeModal')}"
          title="Give feedback"
          href="${surveyUrl}"
          rel="noopener noreferrer"
          target="_blank"
        >
          Give feedback
          <span class="su-btn-disc" aria-hidden="true">${glyphs.arrow()}</span>
        </a>

        <button class="su-link-btn su-mt-4" onclick="${close}" title="Skip">
          Skip
        </button>
      </send-survey-dialog>
    `;
  };
};
