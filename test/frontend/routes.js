const html = require('choo/html');
const assets = require('../../common/assets');
const initScript = require('../../server/initScript');

module.exports = function(app) {
  app.get('/mocha.css', function(req, res) {
    res.sendFile(require.resolve('mocha/mocha.css'));
  });
  app.get('/mocha.js', function(req, res) {
    res.sendFile(require.resolve('mocha/mocha.js'));
  });
  app.get('/test', function(req, res) {
    res.send(
      html`
        <!DOCTYPE html>
        <html>
          <head>
            <link rel="stylesheet" type="text/css" href="/mocha.css" />
            <script src="/mocha.js"></script>
            <script>
              const reporters = mocha.constructor.reporters;
              function Combo(runner) {
                reporters.HTML.call(this, runner);
                reporters.JSON.call(this, runner);
              }
              Object.setPrototypeOf(Combo.prototype, reporters.HTML.prototype);
              mocha.setup({
                ui: 'bdd',
                reporter: Combo,
                timeout: 5000
              });
            </script>
            ${initScript({
              cspNonce: 'test',
              locale: 'en-US'
            })}
            <script src="${assets.get('tests.js')}"></script>
          </head>
          <body>
            <div id="mocha"></div>
            <script>
              /*
               * Wait for the service worker before starting mocha.
               *
               * The suite drives its transfers through the service worker, and
               * navigator.serviceWorker.controller is null until one is active
               * and has claimed the page. Registration is asynchronous, so
               * running mocha straight away let the first test reach
               * navigator.serviceWorker.controller.postMessage before that
               * existed. It failed as "Cannot read property 'postMessage' of
               * null", attributed to whichever test happened to run first and
               * varying with host speed: it reproduced on the Linux verify host
               * and not on a faster local machine, which is the worst way for a
               * harness bug to present.
               *
               * The worker calls clients.claim(), so controllerchange is the
               * signal that it has taken charge. The timeout keeps a failure to
               * register from hanging the run; the tests then report the real
               * error instead of the run never finishing.
               */
              window.runnerReady = (function() {
                if (!('serviceWorker' in navigator)) {
                  return Promise.resolve();
                }
                return navigator.serviceWorker.ready.then(function() {
                  if (navigator.serviceWorker.controller) {
                    return undefined;
                  }
                  return new Promise(function(resolve) {
                    navigator.serviceWorker.addEventListener(
                      'controllerchange',
                      resolve,
                      { once: true }
                    );
                    // Registration may not have happened yet if no test file has
                    // loaded, and ready would otherwise never settle.
                    navigator.serviceWorker
                      .register('/serviceWorker.js')
                      .catch(function() {});
                    setTimeout(resolve, 10000);
                  });
                });
              })();
              window.runnerReady.then(function() {
                window.runner = mocha.run();
              });
            </script>
          </body>
        </html>
      `.toString()
    );
  });
};
