const html = require('choo/html');

module.exports = function(message) {
  return function(state, emit, close) {
    return html`
      <send-ok-dialog class="su-dialog">
        <h2 class="su-title">${message}</h2>
        <button
          class="su-btn su-mt-8 su-justify-center su-w-full"
          onclick="${close}"
          title="${state.translate('okButton')}"
        >
          ${state.translate('okButton')}
        </button>
      </send-ok-dialog>
    `;
  };
};
