import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import { createServerBootstrap } from "../server/app.js";
import {
  AUTH_DATA_DIR_ENV_NAME,
  buildAuthDataDir
} from "../server/lib/auth/keys_manage.js";

const require = createRequire(import.meta.url);
const {
  resolveDesktopAuthDataDir,
  resolveDesktopServerTmpDir,
  resolvePackagedDesktopUserDataPath
} = require("../packaging/desktop/server_storage_paths.js");
const {
  cleanupDesktopUpdaterArtifacts,
  resolveDesktopUpdaterCacheRoots,
  resolveDesktopUpdaterInstallMarkerPath,
  writeDesktopUpdaterInstallMarker
} = require("../packaging/desktop/updater_artifacts.js");
const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(TEST_DIR, "..");

test("packaged desktop uses an OS temp directory outside the bundled server tree", () => {
  assert.equal(resolveDesktopServerTmpDir({ isPackaged: false, tempPath: "/tmp/ignored" }), "");
  assert.equal(
    resolveDesktopServerTmpDir({
      isPackaged: true,
      tempPath: "/run/user/1000"
    }),
    path.join("/run/user/1000", "space-agent", "server-tmp")
  );
});

test("packaged desktop temp directory falls back to the host temp root", () => {
  assert.equal(
    resolveDesktopServerTmpDir({
      isPackaged: true,
      tempPath: ""
    }),
    path.join(os.tmpdir(), "space-agent", "server-tmp")
  );
});

test("packaged desktop keeps the current user-data root when it already owns runtime state", async (testContext) => {
  const runtimeRoot = await fs.mkdtemp(path.join(os.tmpdir(), "space-desktop-user-data-"));
  const appDataPath = path.join(runtimeRoot, "Roaming");
  const currentUserDataPath = path.join(appDataPath, "Space Agent");
  const legacyUserDataPath = path.join(appDataPath, "Agent One");

  testContext.after(async () => {
    await fs.rm(runtimeRoot, {
      force: true,
      recursive: true
    });
  });

  await fs.mkdir(path.join(currentUserDataPath, "customware"), {
    recursive: true
  });
  await fs.mkdir(path.join(legacyUserDataPath, "customware"), {
    recursive: true
  });

  assert.equal(
    resolvePackagedDesktopUserDataPath({
      appDataPath,
      defaultUserDataPath: currentUserDataPath,
      isPackaged: true
    }),
    currentUserDataPath
  );
});

test("packaged desktop reuses the legacy Agent One user-data root when it still owns runtime state", async (testContext) => {
  const runtimeRoot = await fs.mkdtemp(path.join(os.tmpdir(), "space-desktop-legacy-user-data-"));
  const appDataPath = path.join(runtimeRoot, "Roaming");
  const currentUserDataPath = path.join(appDataPath, "Space Agent");
  const legacyUserDataPath = path.join(appDataPath, "Agent One");

  testContext.after(async () => {
    await fs.rm(runtimeRoot, {
      force: true,
      recursive: true
    });
  });

  await fs.mkdir(path.join(legacyUserDataPath, "customware"), {
    recursive: true
  });

  assert.equal(
    resolvePackagedDesktopUserDataPath({
      appDataPath,
      defaultUserDataPath: currentUserDataPath,
      isPackaged: true
    }),
    legacyUserDataPath
  );
});

test("packaged desktop updater cache roots cover current and legacy rebrand directories", () => {
  assert.deepEqual(
    resolveDesktopUpdaterCacheRoots({
      baseCachePath: "/Users/alessandro/AppData/Local",
      isPackaged: true
    }),
    [
      path.join("/Users/alessandro/AppData/Local", "space-agent-updater"),
      path.join("/Users/alessandro/AppData/Local", "agent-one-updater")
    ]
  );
});

test("packaged desktop updater cleanup keeps cached blockmaps but removes stale pending payloads after an install handoff", async (testContext) => {
  const runtimeRoot = await fs.mkdtemp(path.join(os.tmpdir(), "space-desktop-updater-cache-"));
  const localAppDataPath = path.join(runtimeRoot, "Local");
  const userDataPath = path.join(runtimeRoot, "Space Agent");
  const [currentCacheRoot, legacyCacheRoot] = resolveDesktopUpdaterCacheRoots({
    baseCachePath: localAppDataPath,
    isPackaged: true
  });
  const currentPendingPath = path.join(currentCacheRoot, "pending");
  const legacyPendingPath = path.join(legacyCacheRoot, "pending");
  const markerPath = resolveDesktopUpdaterInstallMarkerPath({
    userDataPath
  });

  testContext.after(async () => {
    await fs.rm(runtimeRoot, {
      force: true,
      recursive: true
    });
  });

  await fs.mkdir(currentPendingPath, {
    recursive: true
  });
  await fs.mkdir(legacyPendingPath, {
    recursive: true
  });
  await fs.writeFile(path.join(currentPendingPath, "Space-Agent-0.48-windows-x64.exe"), "installer\n", "utf8");
  await fs.writeFile(path.join(currentCacheRoot, "current.blockmap"), "blockmap\n", "utf8");
  await fs.writeFile(path.join(legacyPendingPath, "Agent-One-0.41-windows-x64.exe"), "installer\n", "utf8");

  const skippedResult = await cleanupDesktopUpdaterArtifacts({
    baseCachePath: localAppDataPath,
    isPackaged: true,
    userDataPath
  });

  assert.equal(skippedResult.cleaned, false);
  assert.equal(skippedResult.reason, "not-marked");
  assert.equal(await fs.stat(currentPendingPath).then(() => true, () => false), true);

  await writeDesktopUpdaterInstallMarker({
    fromVersion: "0.47.0",
    targetVersion: "0.48",
    userDataPath
  });

  const cleanupResult = await cleanupDesktopUpdaterArtifacts({
    baseCachePath: localAppDataPath,
    isPackaged: true,
    userDataPath
  });

  assert.equal(cleanupResult.cleaned, true);
  assert.equal(cleanupResult.marker?.targetVersion, "0.48");
  assert.deepEqual(cleanupResult.clearedPaths.sort(), [currentPendingPath, legacyPendingPath].sort());
  assert.equal(await fs.stat(path.join(currentCacheRoot, "current.blockmap")).then(() => true, () => false), true);
  assert.equal(await fs.stat(currentPendingPath).then(() => true, () => false), false);
  assert.equal(await fs.stat(legacyPendingPath).then(() => true, () => false), false);
  assert.equal(await fs.stat(legacyCacheRoot).then(() => true, () => false), false);
  assert.equal(await fs.stat(markerPath).then(() => true, () => false), false);
});
test("packaged desktop auth data moves to the user-data tree", () => {
  const userDataPath = "/home/alessandro/.config/Space Agent";

  assert.equal(
    resolveDesktopAuthDataDir({
      isPackaged: true,
      userDataPath
    }),
    path.join(userDataPath, "server", "data")
  );
  assert.equal(
    buildAuthDataDir("/tmp/.mount_Space-abc123/resources/app", {
      [AUTH_DATA_DIR_ENV_NAME]: path.join(userDataPath, "server", "data")
    }),
    path.join(userDataPath, "server", "data")
  );
});

test("server bootstrap honors a packaged desktop tmpDir override", async (testContext) => {
  const runtimeRoot = await fs.mkdtemp(path.join(os.tmpdir(), "space-desktop-bootstrap-"));
  const tmpDir = path.join(runtimeRoot, "runtime", "space-agent", "server-tmp");

  testContext.after(async () => {
    await fs.rm(runtimeRoot, {
      force: true,
      recursive: true
    });
  });

  const bootstrap = await createServerBootstrap({
    projectRoot: PROJECT_ROOT,
    runtimeParamEnv: {},
    runtimeParamOverrides: {
      CUSTOMWARE_PATH: path.join(runtimeRoot, "customware"),
      HOST: "127.0.0.1",
      PORT: "0",
      SINGLE_USER_APP: "true",
      WORKERS: "1"
    },
    tmpDir
  });

  const stats = await fs.stat(tmpDir);

  assert.equal(bootstrap.tmpDir, tmpDir);
  assert.equal(stats.isDirectory(), true);
});
