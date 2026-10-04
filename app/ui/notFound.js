const modal = require('./modal');
const terminalState = require('./terminalState');
const glyphs = require('./glyphs');

module.exports = function(state, emit) {
  return terminalState(state, {
    overlay: state.modal && modal(state, emit),
    glyph: glyphs.expired(),
    brandEyebrow: true,
    // Terminal outcome, so the halo does not keep pulsing.
    tone: 'su-glyph-still',
    title: state.translate('expiredTitle'),
    description: state.user.loggedIn
      ? ''
      : state.translate('trySendDescription'),
    action: {
      label: state.translate(
        state.user.loggedIn ? 'okButton' : 'sendYourFilesLink'
      ),
      href: '/'
    }
  });
};
