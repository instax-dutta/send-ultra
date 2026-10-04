const html = require('choo/html');
const Component = require('choo/component');

class Footer extends Component {
  constructor(name, state) {
    super(name);
    this.state = state;
  }

  update() {
    return false;
  }

  createElement() {
    const translate = this.state.translate;
    const webUi = this.state.WEB_UI;

    const links = [];
    const link = (href, label) => html`
      <li>
        <a href="${href}" target="_blank" rel="noopener noreferrer">
          ${label}
        </a>
      </li>
    `;

    if (webUi) {
      if (webUi.FOOTER_DONATE_URL !== '') {
        links.push(
          link(webUi.FOOTER_DONATE_URL, translate('footerLinkDonate'))
        );
      }
      if (webUi.FOOTER_CLI_URL !== '') {
        links.push(link(webUi.FOOTER_CLI_URL, translate('footerLinkCli')));
      }
      if (webUi.FOOTER_DMCA_URL !== '') {
        links.push(link(webUi.FOOTER_DMCA_URL, translate('footerLinkDmca')));
      }
      if (webUi.FOOTER_SOURCE_URL !== '') {
        links.push(
          link(webUi.FOOTER_SOURCE_URL, translate('footerLinkSource'))
        );
      }
    } else {
      links.push(
        link('https://github.com/timvisee/send', translate('footerLinkSource'))
      );
    }

    // An operator can replace the left-hand footer text entirely.
    let statement;
    if (webUi && webUi.CUSTOM_FOOTER_TEXT !== '') {
      statement = webUi.CUSTOM_FOOTER_TEXT;
    } else if (webUi && webUi.CUSTOM_FOOTER_URL !== '') {
      statement = html`
        <a
          href="${webUi.CUSTOM_FOOTER_URL}"
          target="_blank"
          rel="noopener noreferrer"
          >${webUi.CUSTOM_FOOTER_TEXT || webUi.CUSTOM_FOOTER_URL}</a
        >
      `;
    } else {
      statement = translate('footerText');
    }

    return html`
      <footer class="su-footer">
        <span>${statement}</span>
        <ul>
          ${links}
        </ul>
      </footer>
    `;
  }
}

module.exports = Footer;
