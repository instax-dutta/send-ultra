const html = require('choo/html');

module.exports = function(state, emit) {
  /*
   * A frosted sheet rather than an opaque panel. The blur lives on this
   * fixed overlay only, never on a scrolling container, so the compositor can
   * cache it instead of re-blurring on every scroll frame.
   */
  return html`
    <send-modal class="su-modal">
      <div class="su-modal-veil"></div>
      <div class="su-modal-sheet">
        <div class="su-modal-core su-enter-sm">
          ${state.modal(state, emit, close)}
        </div>
      </div>
    </send-modal>
  `;

  function close(event) {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    emit('closeModal');
  }
};
