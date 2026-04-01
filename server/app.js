import http from "node:http";

import {
  API_DIR,
  APP_DIR,
  ASSET_DIR,
  DEFAULT_HOST,
  DEFAULT_PORT,
  FILE_WATCH_CONFIG_PATH,
  PAGES_DIR,
  PROJECT_ROOT
} from "./config.js";
import { loadApiRegistry } from "./lib/api/registry.js";
import { createAuthService } from "./lib/auth/service.js";
import { createWatchdog } from "./lib/file-watch/watchdog.js";
import { sendJson } from "./router/responses.js";
import { createRequestHandler } from "./router/router.js";

function resolveBrowserHost(host) {
  if (host === "0.0.0.0" || host === "::" || host === "[::]") {
    return "127.0.0.1";
  }

  return host;
}

async function createAgentServer(overrides = {}) {
  const apiDir = overrides.apiDir || API_DIR;
  const appDir = overrides.appDir || APP_DIR;
  const host = overrides.host || DEFAULT_HOST;
  const browserHost = overrides.browserHost || resolveBrowserHost(host);
  const port = Number(overrides.port || DEFAULT_PORT);
  const assetDir = overrides.assetDir || ASSET_DIR;
  const pagesDir = overrides.pagesDir || PAGES_DIR;
  const projectRoot = overrides.projectRoot || PROJECT_ROOT;
  const watchdog =
    overrides.watchdog ||
    createWatchdog({
      configPath: overrides.fileWatchConfigPath || FILE_WATCH_CONFIG_PATH,
      projectRoot
    });
  const auth = overrides.auth || createAuthService({ projectRoot, watchdog });

  const apiRegistry = await loadApiRegistry(apiDir);
  const requestHandler = createRequestHandler({
    apiDir,
    apiRegistry,
    appDir,
    auth,
    assetDir,
    pagesDir,
    watchdog,
    host,
    port,
    projectRoot
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
    pagesDir,
    auth,
    watchdog,
    server,
    browserUrl: `http://${browserHost}:${port}`,
    async listen() {
      await watchdog.start();

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
            pagesDir,
            auth,
            watchdog,
            server,
            browserUrl: `http://${browserHost}:${port}`
          });
        });
      });
    },
    async close() {
      watchdog.stop();

      await new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });
    }
  };
}

export { createAgentServer };
