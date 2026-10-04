const html = require('choo/html');
const { bytes } = require('../utils');

module.exports = function() {
  return function(state, emit, close) {
    const DAYS = Math.floor(state.LIMITS.MAX_EXPIRE_SECONDS / 86400);
    let submitting = false;
    return html`
      <send-signup-dialog class="su-dialog">
        <span class="su-eyebrow">
          <span class="su-eyebrow-dot"></span>
          ${state.translate('-send-brand')}
        </span>
        <h1 class="su-title su-mt-5">
          ${state.translate('accountBenefitTitle')}
        </h1>
        <section class="su-mt-5 su-w-full">
          <ul class="su-list su-text-left">
            <li>
              ${state.translate('accountBenefitLargeFiles', {
                size: bytes(state.LIMITS.MAX_FILE_SIZE)
              })}
            </li>
            <li>${state.translate('accountBenefitDownloadCount')}</li>
            <li>
              ${state.translate('accountBenefitTimeLimit', { count: DAYS })}
            </li>
            <li>${state.translate('accountBenefitSync')}</li>
          </ul>
        </section>
        <section class="su-w-full su-mt-6">
          <form onsubmit=${submitEmail} data-no-csrf>
            <input
              id="email-input"
              type="email"
              class="hidden su-input su-text-left"
              placeholder=${state.translate('emailPlaceholder')}
            />
            <input
              class="su-btn su-mt-6 su-justify-center su-w-full"
              value="${state.translate('signInOnlyButton')}"
              title="${state.translate('signInOnlyButton')}"
              id="email-submit"
              type="submit"
            />
          </form>
          ${state.user.loginRequired
            ? ''
            : html`
                <button
                  class="su-link-btn su-mt-4"
                  title="${state.translate('deletePopupCancel')}"
                  onclick=${cancel}
                >
                  ${state.translate('deletePopupCancel')}
                </button>
              `}
        </section>
      </send-signup-dialog>
    `;

    function emailish(str) {
      if (!str) {
        return false;
      }
      // just check if it's the right shape
      const a = str.split('@');
      return a.length === 2 && a.every(s => s.length > 0);
    }

    function cancel(event) {
      close(event);
    }

    function submitEmail(event) {
      event.preventDefault();
      if (submitting) {
        return;
      }
      submitting = true;

      const el = document.getElementById('email-input');
      const email = el.value;
      emit('login', emailish(email) ? email : null);
    }
  };
};
