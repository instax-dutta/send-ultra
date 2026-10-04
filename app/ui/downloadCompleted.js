const terminalState = require('./terminalState');
const glyphs = require('./glyphs');

module.exports = function(state) {
  /*
   * The id is kept: it is the marker the transfer tests and any support
   * tooling use to confirm the decrypted file was handed to the browser.
   */
  return terminalState(state, {
    id: 'download-complete',
    glyph: glyphs.check(),
    brandEyebrow: true,
    title: state.translate('downloadFinish'),
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
