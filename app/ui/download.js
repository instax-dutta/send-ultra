/* global downloadMetadata */
const html = require('choo/html');
const archiveTile = require('./archiveTile');
const modal = require('./modal');
const noStreams = require('./noStreams');
const notFound = require('./notFound');
const downloadPassword = require('./downloadPassword');
const downloadCompleted = require('./downloadCompleted');
const eyebrow = require('./eyebrow');
const BIG_SIZE = 1024 * 1024 * 256;

function createFileInfo(state) {
  return {
    id: state.params.id,
    secretKey: state.params.key,
    nonce: downloadMetadata.nonce,
    requiresPassword: downloadMetadata.pwd
  };
}

function downloading(state, emit) {
  return html`
    <div class="su-col su-enter">
      <span class="su-eyebrow su-mx-auto">
        <span class="su-eyebrow-dot"></span>
        ${state.translate('downloadingTitle')}
      </span>
      ${archiveTile.downloading(state, emit)}
    </div>
  `;
}

function preview(state, emit) {
  if (!state.capabilities.streamDownload && state.fileInfo.size > BIG_SIZE) {
    return noStreams(state, emit);
  }
  return html`
    <div class="su-col su-enter">
      ${eyebrow(state, 'su-mx-auto')}
      <h1 class="su-title su-mt-5 su-mx-auto">
        ${state.translate('downloadTitle')}
      </h1>
      <p class="su-lede su-mx-auto">
        ${state.translate('downloadDescription')}
      </p>
      ${archiveTile.preview(state, emit)}
    </div>
  `;
}

module.exports = function(state, emit) {
  let content = '';
  if (!state.fileInfo) {
    state.fileInfo = createFileInfo(state);
    if (downloadMetadata.status === 404) {
      return notFound(state, emit);
    }
    if (!state.fileInfo.nonce) {
      // coming from something like the browser back button
      return location.reload();
    }
  }

  if (!state.transfer && !state.fileInfo.requiresPassword) {
    emit('getMetadata');
  }

  if (state.transfer) {
    switch (state.transfer.state) {
      case 'downloading':
      case 'decrypting':
        content = downloading(state, emit);
        break;
      case 'complete':
        content = downloadCompleted(state);
        break;
      default:
        content = preview(state, emit);
    }
  } else if (state.fileInfo.requiresPassword && !state.fileInfo.password) {
    content = downloadPassword(state, emit);
  }

  /*
   * The receiver flow is a single centred column rather than a bento: there is
   * one thing to do, so a second column would only dilute it. The surrounding
   * shell is identical to the upload route.
   */
  return html`
    <main class="su-main">
      ${state.modal && modal(state, emit)} ${content}
    </main>
  `;
};
