const http = require("node:http");
const { API_DIR, APP_DIR, ASSET_DIR, DEFAULT_HOST, DEFAULT_PORT } = require("./config");
const { loadApiRegistry } = require("./api-registry");
const { sendJson } = require("./http/handlers");
const { createRequestHandler } = require("./http/router");

function resolveBrowserHost(host) {
  if (host === "0.0.0.0" || host === "::" || host === "[::]") {
    return "127.0.0.1";
  }

  return host;
}

function createAgentServer(overrides = {}) {
  const apiDir = overrides.apiDir || API_DIR;
  const appDir = overrides.appDir || APP_DIR;
  const host = overrides.host || DEFAULT_HOST;
  const browserHost = overrides.browserHost || resolveBrowserHost(host);
  const port = Number(overrides.port || DEFAULT_PORT);
  const assetDir = overrides.assetDir || ASSET_DIR;
  const apiRegistry = loadApiRegistry(apiDir);
  const requestHandler = createRequestHandler({
    apiDir,
    apiRegistry,
    appDir,
    assetDir,
    host,
    port
  });
  const server = http.createServer((req, res) => {
    Promise.resolve(requestHandler(req, res)).catch((error) => {
      console.error("Request handling failed.");
      console.error(error);

      if (res.headersSent) {
        res.destroy(error);
        return;
      }

      sendJson(res, 500, {
        error: "Internal server error"
      });
    });
  });

  return {
    apiDir,
    apiRegistry,
    appDir,
    browserHost,
    host,
    port,
    assetDir,
    server,
    browserUrl: `http://${browserHost}:${port}`,
    listen() {
      return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, host, () => {
          server.removeListener("error", reject);
          resolve({
            apiDir,
            apiRegistry,
            appDir,
            browserHost,
            host,
            port,
            assetDir,
            server,
            browserUrl: `http://${browserHost}:${port}`
          });
        });
      });
    }
  };
}

module.exports = {
  createAgentServer
};
