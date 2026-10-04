const html = require('choo/html');
const Header = require('./header');
const Footer = require('./footer');

module.exports = function body(main) {
  return function(state, emit) {
    /*
     * The lit background is two fixed orb divs plus a fixed grain layer rather
     * than a painted background-image. Fixed positioning lets the compositor
     * cache them, so scrolling never repaints them, and pointer-events are off
     * so they cannot swallow a click meant for the drop zone.
     */
    const field = html`
      <div class="su-field" aria-hidden="true">
        <div class="su-orb su-orb-a"></div>
        <div class="su-orb su-orb-b"></div>
      </div>
      <div class="su-grain" aria-hidden="true"></div>
    `;

    const b = html`
      <body class="su-root font-sans text-grey-10 antialiased">
        ${field}
        <div
          class="su-stage relative z-10 flex flex-col items-center min-h-screen-dvh"
        >
          ${state.cache(Header, 'header').render()} ${main(state, emit)}
          ${state.cache(Footer, 'footer').render()}
        </div>
      </body>
    `;
    if (state.layout) {
      // server side only
      return state.layout(state, b);
    }
    return b;
  };
};
