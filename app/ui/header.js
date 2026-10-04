const html = require('choo/html');
const Component = require('choo/component');
const Account = require('./account');
const assets = require('../../common/assets');
const { platform } = require('../utils');
const eyebrow = require('./eyebrow');

class Header extends Component {
  constructor(name, state, emit) {
    super(name);
    this.state = state;
    this.emit = emit;
    this.account = state.cache(Account, 'account');
  }

  update() {
    this.account.render();
    return false;
  }

  createElement() {
    let assetMap = {};
    if (this.state.ui !== undefined) assetMap = this.state.ui.assets;
    else
      assetMap = {
        icon:
          this.state.WEB_UI.CUSTOM_ASSETS.icon !== ''
            ? this.state.WEB_UI.CUSTOM_ASSETS.icon
            : assets.get('icon.svg'),
        wordmark:
          this.state.WEB_UI.CUSTOM_ASSETS.wordmark !== ''
            ? this.state.WEB_UI.CUSTOM_ASSETS.wordmark
            : assets.get('wordmark.svg') + '#logo'
      };
    const brand = eyebrow.brand(this.state);

    /*
     * The original wordmark was a vector drawing of "Send", so it could not
     * spell a longer name. The brand name is set in type instead, which keeps
     * it correct for every locale and needs no new artwork.
     */
    const mark = html`
      <span class="su-wordmark">${brand}</span>
    `;

    const title =
      platform() === 'android'
        ? html`
            <a class="su-brand" href="/"> ${assetMap.icon} ${mark} </a>
          `
        : html`
            <a class="su-brand" href="/">
              <img class="su-brand-icon" alt="" src="${assetMap.icon}" />
              ${mark}
            </a>
          `;

    return html`
      <header class="su-header">
        <div class="su-header-inner su-enter">
          ${title}
          <div class="su-header-slot">${this.account.render()}</div>
        </div>
      </header>
    `;
  }
}

module.exports = Header;
