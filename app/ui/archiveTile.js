/* global Android */

const html = require('choo/html');
const raw = require('choo/html/raw');
const assets = require('../../common/assets');
const {
  bytes,
  copyToClipboard,
  list,
  percent,
  platform,
  timeLeft
} = require('../utils');
const expiryOptions = require('./expiryOptions');
const { formatDuration } = require('../transferTiming');
const eyebrow = require('./eyebrow');
const glyphs = require('./glyphs');

function expiryInfo(translate, archive) {
  const l10n = timeLeft(archive.expiresAt - Date.now());
  return raw(
    translate('archiveExpiryInfo', {
      downloadCount: translate('downloadCount', {
        num: archive.dlimit - archive.dtotal
      }),
      timespan: translate(l10n.id, l10n)
    })
  );
}

function password(state) {
  const MAX_LENGTH = 4096;

  return html`
    <div class="mb-2 px-1">
      <input
        id="autocomplete-decoy"
        class="hidden"
        type="password"
        value="lol"
      />
      <div class="checkbox inline-block mr-3">
        <input
          id="add-password"
          type="checkbox"
          ${state.archive.password ? 'checked' : ''}
          autocomplete="off"
          onchange="${togglePasswordInput}"
        />
        <label for="add-password">
          ${state.translate('addPassword')}
        </label>
      </div>
      <div class="relative inline-block my-1">
        <input
          id="password-input"
          class="${state.archive.password
            ? ''
            : 'invisible'} border-default rounded-default focus:border-primary leading-normal my-1 py-1 px-2 h-8 dark:bg-grey-80"
          autocomplete="off"
          maxlength="${MAX_LENGTH}"
          type="password"
          oninput="${inputChanged}"
          onfocus="${focused}"
          placeholder="${state.translate('unlockInputPlaceholder')}"
          value="${state.archive.password || ''}"
        />
        <button
          id="password-preview-button"
          type="button"
          class="${state.archive.password
            ? ''
            : 'invisible'} absolute top-0 right-0 w-8 h-8"
          onclick="${onPasswordPreviewButtonclicked}"
        >
          <img
            src="${assets.get('eye.svg')}"
            width="22"
            height="22"
            class="m-auto mt-2"
          />
        </button>
      </div>
      <label
        id="password-msg"
        for="password-input"
        class="block text-xs text-grey-70"
      ></label>
    </div>
  `;

  function onPasswordPreviewButtonclicked(event) {
    event.preventDefault();
    const input = document.getElementById('password-input');
    const eyeIcon = event.currentTarget.querySelector('img');

    if (input.type === 'password') {
      input.type = 'text';
      eyeIcon.src = assets.get('eye-off.svg');
    } else {
      input.type = 'password';
      eyeIcon.src = assets.get('eye.svg');
    }

    input.focus();
  }

  function togglePasswordInput(event) {
    event.stopPropagation();
    const checked = event.target.checked;
    const input = document.getElementById('password-input');
    const passwordPreviewButton = document.getElementById(
      'password-preview-button'
    );
    if (checked) {
      input.classList.remove('invisible');
      passwordPreviewButton.classList.remove('invisible');
      input.focus();
    } else {
      input.classList.add('invisible');
      passwordPreviewButton.classList.add('invisible');
      input.value = '';
      document.getElementById('password-msg').textContent = '';
      state.archive.password = null;
    }
  }

  function inputChanged() {
    const passwordInput = document.getElementById('password-input');
    const pwdmsg = document.getElementById('password-msg');
    const password = passwordInput.value;
    const length = password.length;

    if (length === MAX_LENGTH) {
      pwdmsg.textContent = state.translate('maxPasswordLength', {
        length: MAX_LENGTH
      });
    } else {
      pwdmsg.textContent = '';
    }
    state.archive.password = password;
  }

  function focused(event) {
    event.preventDefault();
    const el = document.getElementById('password-input');
    if (el.placeholder !== state.translate('unlockInputPlaceholder')) {
      el.placeholder = '';
    }
  }
}

/*
 * Percent on the left, time remaining and throughput on the right.
 *
 * Shows a placeholder rather than a number until there is enough signal to be
 * honest: an estimate computed from the first second of a connection is mostly
 * TCP slow start and reads as "2s left" for a forty minute transfer.
 */
function transferReadout(state) {
  const ratio = state.transfer.progressRatio;
  const pct = percent(ratio);
  const eta = state.transfer.progressEta;
  const rate = state.transfer.progressRate;

  const remaining =
    eta === null || eta === undefined
      ? html`
          <span class="su-readout-pending">
            ${state.translate('transferEstimating')}
          </span>
        `
      : html`
          <span>
            ${state.translate('transferRemaining', {
              time: formatDuration(eta)
            })}
          </span>
        `;

  const speed =
    rate > 0
      ? html`
          <span>${bytes(rate)}/s</span>
        `
      : html`
          <span class="su-readout-pending">&mdash;</span>
        `;

  return html`
    <div class="su-readout">
      <span class="su-readout-value">${pct}</span>
      <span class="su-readout-meta">
        ${remaining}
        <span class="su-readout-sep">&middot;</span>
        ${speed}
      </span>
    </div>
  `;
}

function fileInfo(file, action) {
  return html`
    <send-file class="su-meta">
      <svg class="su-meta-icon">
        <use xlink:href="${assets.get('blue_file.svg')}#icon" />
      </svg>
      <div class="su-meta-body">
        <p class="su-meta-name">${file.name}</p>
        <p class="su-meta-size">${bytes(file.size)}</p>
      </div>
      ${action}
    </send-file>
  `;
}

function archiveInfo(archive, action) {
  return html`
    <div class="su-meta">
      <svg class="su-meta-icon">
        <use xlink:href="${assets.get('blue_file.svg')}#icon" />
      </svg>
      <div class="su-meta-body">
        <p class="su-meta-name">${archive.name}</p>
        <p class="su-meta-size">${bytes(archive.size)}</p>
      </div>
      ${action}
    </div>
  `;
}

function archiveDetails(translate, archive) {
  if (archive.manifest.files.length > 1) {
    return html`
      <details
        class="w-full pb-1"
        ${archive.open ? 'open' : ''}
        ontoggle="${toggled}"
      >
        <summary class="su-toggle">
          <svg
            class="su-toggle-chevron fill-current"
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
          >
            <path
              d="M12.95 10.707l.707-.707L8 4.343 6.586 5.757 10.828 10l-4.242 4.243L8 15.657l4.95-4.95z"
            />
          </svg>
          ${translate('fileCount', {
            num: archive.manifest.files.length
          })}
        </summary>
        <ul class="su-manifest">
          ${archive.manifest.files.map(
            f => html`
              <li class="su-manifest-item">
                <span class="word-break-all">${f.name}</span>
                <span class="su-manifest-size">${bytes(f.size)}</span>
              </li>
            `
          )}
        </ul>
      </details>
    `;
  }
  function toggled(event) {
    event.stopPropagation();
    archive.open = event.target.open;
  }
}

module.exports = function(state, emit, archive) {
  const copyOrShare =
    state.capabilities.share || platform() === 'android'
      ? html`
          <button class="su-card-action" onclick=${share} title="Share link">
            <svg class="h-4 w-4">
              <use xlink:href="${assets.get('share-24.svg')}#icon" />
            </svg>
            Share link
          </button>
        `
      : html`
          <button
            class="su-card-action"
            onclick=${copy}
            title="${state.translate('copyLinkButton')}"
          >
            <svg class="h-4 w-4">
              <use xlink:href="${assets.get('copy-16.svg')}#icon" />
            </svg>
            ${state.translate('copyLinkButton')}
          </button>
        `;
  const dl =
    platform() === 'web'
      ? html`
          <a
            class="su-card-action"
            href="${archive.url}"
            title="${state.translate('downloadButtonLabel')}"
            tabindex="0"
          >
            <svg class="h-4 w-3">
              <use xlink:href="${assets.get('dl.svg')}#icon" />
            </svg>
            ${state.translate('downloadButtonLabel')}
          </a>
        `
      : html`
          <div></div>
        `;
  return html`
    <send-archive id="archive-${archive.id}" class="su-filecard">
      ${archiveInfo(
        archive,
        html`
          <input
            type="image"
            class="su-icon-btn"
            alt="${state.translate('deleteButtonHover')}"
            title="${state.translate('deleteButtonHover')}"
            src="${assets.get('close-16.svg')}"
            onclick=${del}
          />
        `
      )}
      <div class="su-muted su-text-sm w-full su-mt-3 su-mb-2">
        ${expiryInfo(state.translate, archive)}
      </div>
      ${archiveDetails(state.translate, archive)}
      <hr class="su-rule su-my-5" />
      <div class="su-actions">
        ${dl} ${copyOrShare}
      </div>
    </send-archive>
  `;

  function copy(event) {
    event.stopPropagation();
    copyToClipboard(archive.url);
    const text = event.target.lastChild;
    text.textContent = state.translate('copiedUrl');
    setTimeout(
      () => (text.textContent = state.translate('copyLinkButton')),
      1000
    );
  }

  function del(event) {
    event.stopPropagation();
    emit('delete', archive);
  }

  async function share(event) {
    event.stopPropagation();
    if (platform() === 'android') {
      Android.shareUrl(archive.url);
    } else {
      try {
        await navigator.share({
          title: state.brand || state.translate('-send-brand'),
          text: `Download "${archive.name}" with Send Ultra: simple, safe file sharing`,
          //state.translate('shareMessage', { name }),
          url: archive.url
        });
      } catch (e) {
        // ignore
      }
    }
  }
};

module.exports.wip = function(state, emit) {
  /*
   * Structure note: the file list must stay a direct <ul> child of #wip, and
   * #file-upload must be immediately followed by the element that focus/blur
   * toggle, because add() and the focus handlers reach into the DOM directly.
   */
  return html`
    <send-upload-area class="su-shell su-flex-1" id="wip">
      <div class="su-core su-flex-1 su-flex-col">
        ${list(
          Array.from(state.archive.files)
            .reverse()
            .map(f =>
              fileInfo(f, remove(f, state.translate('deleteButtonHover')))
            ),
          'su-filelist',
          'su-fileitem su-enter-sm'
        )}

        <div class="su-wip-bar">
          <input
            id="file-upload"
            class="su-visually-hidden"
            type="file"
            multiple
            onfocus="${focus}"
            onblur="${blur}"
            onchange="${add}"
          />
          <div for="file-upload" class="su-wip-row">
            <label
              for="file-upload"
              class="su-ghost su-cursor-pointer"
              title="${state.translate('addFilesButton')}"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path
                  d="M7 2.5v9M2.5 7h9"
                  stroke="currentColor"
                  stroke-width="1.4"
                  stroke-linecap="round"
                />
              </svg>
              ${state.translate('addFilesButton')}
            </label>
            <span class="su-mono su-muted">
              ${state.translate('totalSize', {
                size: bytes(state.archive.size)
              })}
            </span>
          </div>
        </div>

        <div class="su-wip-controls">
          ${expiryOptions(state, emit)} ${password(state, emit)}
        </div>

        <button
          id="upload-btn"
          class="su-btn su-mt-6 su-justify-center su-w-full"
          title="${state.translate('uploadButton')}"
          onclick="${upload}"
        >
          ${state.translate('uploadButton')}
          <span class="su-btn-disc" aria-hidden="true">
            ${glyphs.upload()}
          </span>
        </button>
      </div>
    </send-upload-area>
  `;

  function focus(event) {
    event.target.nextElementSibling.firstElementChild.classList.add('su-focus');
  }

  function blur(event) {
    event.target.nextElementSibling.firstElementChild.classList.remove(
      'su-focus'
    );
  }

  function upload(event) {
    window.scrollTo(0, 0);
    event.preventDefault();
    event.target.disabled = true;
    if (!state.uploading) {
      emit('upload');
    }
  }

  function add(event) {
    event.preventDefault();
    const newFiles = Array.from(event.target.files);

    emit('addFiles', { files: newFiles });
    setTimeout(() => {
      const first = document.querySelector('#wip > ul > li:first-child');
      if (first) {
        first.scrollIntoView({ block: 'center' });
      }
    });
  }

  function remove(file, desc) {
    return html`
      <input
        type="image"
        class="su-file-remove"
        alt="${desc}"
        title="${desc}"
        src="${assets.get('close-16.svg')}"
        onclick="${del}"
      />
    `;
    function del(event) {
      event.stopPropagation();
      emit('removeUpload', file);
    }
  }
};

module.exports.uploading = function(state, emit) {
  const progress = state.transfer.progressRatio;
  const progressPercent = percent(progress);
  const archive = state.archive;
  return html`
    <send-upload-area id="${archive.id}" class="su-shell su-flex-1">
      <div class="su-core su-p-8 su-flex-1">
        ${archiveInfo(archive)}
        <p class="su-muted su-text-sm su-mt-3">
          ${expiryInfo(state.translate, {
            dlimit: state.archive.dlimit,
            dtotal: 0,
            expiresAt: Date.now() + 500 + state.archive.timeLimit * 1000
          })}
        </p>
        ${transferReadout(state)}
        <progress class="su-progress" value="${progress}">
          ${progressPercent}
        </progress>
        <button
          class="su-ghost su-mt-8"
          onclick=${cancel}
          title="${state.translate('deletePopupCancel')}"
        >
          ${state.translate('deletePopupCancel')}
        </button>
      </div>
    </send-upload-area>
  `;

  function cancel(event) {
    event.stopPropagation();
    event.target.disabled = true;
    emit('cancel');
  }
};

module.exports.empty = function(state, emit) {
  const upsell =
    state.user.loggedIn || !state.capabilities.account
      ? ''
      : html`
          <button
            class="su-signin"
            onclick="${event => {
              event.stopPropagation();
              emit('signup-cta', 'drop');
            }}"
          >
            ${state.translate('signInSizeBump', {
              size: bytes(state.LIMITS.MAX_FILE_SIZE)
            })}
          </button>
        `;
  const uploadNotice = state.WEB_UI.UPLOAD_AREA_NOTICE_HTML
    ? html`
        <p class="su-notice su-mt-6">
          ${raw(state.WEB_UI.UPLOAD_AREA_NOTICE_HTML)}
        </p>
      `
    : '';

  return html`
    <send-upload-area class="su-shell su-flex-1" id="empty">
      <div
        class="su-drop su-core"
        onclick="${e => {
          if (e.target.tagName !== 'LABEL') {
            document.getElementById('file-upload').click();
          }
        }}"
      >
        <div class="su-halo su-enter su-d2">
          <svg class="su-halo-icon">
            <use xlink:href="/${assets.get('addfiles.svg')}#plus" />
          </svg>
        </div>

        ${eyebrow(state, 'su-mt-8 su-enter su-d3')}

        <h1
          class="su-mt-5 su-mb-3 su-drop-title su-enter su-d4"
          title="${state.translate('dragAndDropFiles')}"
        >
          ${state.translate('dragAndDropFiles')}
        </h1>

        <p class="su-drop-sub su-enter su-d5">
          ${state.translate('orClickWithSize', {
            size: bytes(state.user.maxSize)
          })}
        </p>

        <input
          id="file-upload"
          class="su-visually-hidden"
          type="file"
          multiple
          onfocus="${focus}"
          onblur="${blur}"
          onchange="${add}"
          onclick="${e => e.stopPropagation()}"
        />
        <label
          for="file-upload"
          role="button"
          class="su-btn su-mt-8 su-enter su-d6"
          title="${state.translate('addFilesButton', {
            size: bytes(state.user.maxSize)
          })}"
        >
          ${state.translate('addFilesButton')}
          <span class="su-btn-disc" aria-hidden="true">
            ${glyphs.arrow()}
          </span>
        </label>
        ${upsell} ${uploadNotice}
      </div>
    </send-upload-area>
  `;

  function focus(event) {
    event.target.nextElementSibling.classList.add('su-focus');
  }

  function blur(event) {
    event.target.nextElementSibling.classList.remove('su-focus');
  }

  function add(event) {
    event.preventDefault();
    const newFiles = Array.from(event.target.files);

    emit('addFiles', { files: newFiles });
  }
};

module.exports.preview = function(state, emit) {
  const archive = state.fileInfo;
  if (archive.open === undefined) {
    archive.open = true;
  }
  const single = archive.manifest.files.length === 1;
  const details = single
    ? ''
    : html`
        <ul class="su-manifest">
          ${archive.manifest.files.map(
            f => html`
              <li class="su-manifest-item">
                <span class="word-break-all">${f.name}</span>
                <span class="su-manifest-size">${bytes(f.size)}</span>
              </li>
            `
          )}
        </ul>
      `;
  const notice = state.WEB_UI.DOWNLOAD_NOTICE_HTML
    ? html`
        <p class="su-notice su-mt-5">
          ${raw(state.WEB_UI.DOWNLOAD_NOTICE_HTML)}
        </p>
      `
    : '';
  const sponsor = state.WEB_UI.SHOW_THUNDERBIRD_SPONSOR
    ? html`
        <a
          class="su-notice su-notice-link su-mt-3"
          href="https://www.thunderbird.net/"
          rel="noopener noreferrer"
          target="_blank"
        >
          <svg width="18" height="18" class="su-notice-icon">
            <image
              xlink:href="${assets.get('thunderbird-icon.svg')}"
              src="${assets.get('thunderbird-icon.svg')}"
              width="18"
              height="18"
            />
          </svg>
          ${state.translate('sponsoredByThunderbird')}
        </a>
      `
    : '';

  return html`
    <send-archive class="su-shell su-w-full su-mt-8 su-enter-sm">
      <div class="su-core su-card">
        ${archiveInfo(archive)} ${details}
        <button
          id="download-btn"
          class="su-btn su-mt-6 su-justify-center su-w-full"
          title="${state.translate('downloadButtonLabel')}"
          onclick=${download}
        >
          ${state.translate('downloadButtonLabel')}
          <span class="su-btn-disc" aria-hidden="true">
            ${glyphs.downloadDisc()}
          </span>
        </button>
        ${notice} ${sponsor}
      </div>
    </send-archive>
  `;

  function download(event) {
    event.preventDefault();
    event.target.disabled = true;
    emit('download');
  }
};

module.exports.downloading = function(state) {
  const archive = state.fileInfo;
  const progress = state.transfer.progressRatio;
  const progressPercent = percent(progress);
  return html`
    <send-archive class="su-shell su-w-full su-mt-8 su-enter-sm">
      <div class="su-core su-card">
        ${archiveInfo(archive)} ${transferReadout(state)}
        <progress class="su-progress" value="${progress}"
          >${progressPercent}</progress
        >
      </div>
    </send-archive>
  `;
};
