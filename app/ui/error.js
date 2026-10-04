const modal = require('./modal');
const terminalState = require('./terminalState');
const glyphs = require('./glyphs');

module.exports = function(state, emit) {
  return terminalState(state, {
    overlay: state.modal && modal(state, emit),
    glyph: glyphs.alert(),
    brandEyebrow: true,
    tone: 'su-glyph-warn',
    title: state.translate('errorPageHeader'),
    // Shown to signed-out visitors only, as before: a signed-in user has no
    // use for the acquisition prompt.
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
