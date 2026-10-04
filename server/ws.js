const http = require('http');
const { WebSocketServer } = require('ws');

/*
 * Drop-in replacement for @dannycoates/express-ws, which pulled in the
 * unmaintained `esm` loader and could not boot on modern Node.
 *
 * Semantics are kept identical: an upgrade request is pushed back through the
 * Express middleware chain (so trust-proxy, CSP and geo handling behave the
 * same as on the HTTP routes), and only then handed to the WebSocket handler.
 */

const WS_SUFFIX = '.websocket';

function withTrailingSlash(str) {
  return str.endsWith('/') ? str : `${str}/`;
}

function websocketUrl(url) {
  if (url.indexOf('?') !== -1) {
    const [baseUrl, query] = url.split('?');
    return `${withTrailingSlash(baseUrl)}${WS_SUFFIX}?${query}`;
  }
  return `${withTrailingSlash(url)}${WS_SUFFIX}`;
}

function wrapMiddleware(middleware) {
  return (req, res, next) => {
    if (req.ws !== null && req.ws !== undefined) {
      req.wsHandled = true;
      try {
        middleware(req.ws, req, next);
      } catch (err) {
        next(err);
      }
    } else {
      next();
    }
  };
}

module.exports = function attachWs(app, wsOptions = {}) {
  const server = http.createServer(app);
  const wss = new WebSocketServer({
    noServer: true,
    perMessageDeflate: false,
    ...wsOptions
  });

  // Every registered ws route, in the rewritten form an upgrade is matched
  // against. Upstream accepted every upgrade and let Express routing reject the
  // non-matches; tracking the real paths lets us reject them before spending a
  // handshake on them.
  const wsPaths = new Set();

  app.ws = function addWsRoute(route, ...middlewares) {
    const path = websocketUrl(route);
    wsPaths.add(path.split('?')[0]);
    app.get(path, ...middlewares.map(wrapMiddleware));
    return app;
  };

  wss.on('connection', (socket, request) => {
    if ('upgradeReq' in socket) {
      request = socket.upgradeReq;
    }
    request.ws = socket;
    request.wsHandled = false;
    // Push the request through the Express middleware chain.
    request.url = websocketUrl(request.url);

    const dummyResponse = new http.ServerResponse(request);
    dummyResponse.writeHead = function writeHead(statusCode) {
      if (statusCode > 200) {
        dummyResponse._header = ''; // eslint-disable-line no-underscore-dangle
        socket.close();
      }
    };

    app.handle(request, dummyResponse, () => {
      if (!request.wsHandled) {
        socket.close();
      }
    });
  });

  server.on('upgrade', (request, socket, head) => {
    let pathname;
    try {
      pathname = new URL(request.url, 'http://localhost').pathname;
    } catch (e) {
      socket.destroy();
      return;
    }
    if (!wsPaths.has(websocketUrl(pathname).split('?')[0])) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(request, socket, head, ws => {
      wss.emit('connection', ws, request);
    });
  });

  // `server` only exists once listen() is called, so expose the server-backed
  // listen. All call sites use app.listen().
  app.listen = function serverListen(...args) {
    return server.listen(...args);
  };

  return { app, server, wss, getWss: () => wss };
};
