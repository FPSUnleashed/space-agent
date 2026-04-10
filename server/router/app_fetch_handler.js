import path from "node:path";

import { createAppAccessController } from "../lib/customware/file_access.js";
import { isReservedAppProjectPath } from "../lib/customware/git_history.js";
import { getRuntimeGroupIndex } from "../lib/customware/group_runtime.js";
import {
  normalizeAppProjectPath,
  resolveProjectAbsolutePath
} from "../lib/customware/layout.js";
import { sendFile, sendJson, sendNotFound } from "./responses.js";

function resolveAppFetchProjectPath(requestPath, username) {
  const normalizedPath = path.posix.normalize(requestPath || "/");
  let appRelativePath;

  if (normalizedPath.startsWith("/~/")) {
    if (!username) return null;
    appRelativePath = `L2/${username}/${normalizedPath.slice(3)}`;
  } else if (/^\/(L0|L1|L2)\//.test(normalizedPath)) {
    appRelativePath = normalizedPath.slice(1);
  } else {
    return null;
  }

  const projectPath = normalizeAppProjectPath(appRelativePath);
  return projectPath && projectPath.startsWith("/app/") ? projectPath : null;
}

function handleAppFetchRequest(res, requestPath, options = {}) {
  const { projectRoot, runtimeParams, username, watchdog } = options;
  const projectPath = resolveAppFetchProjectPath(requestPath, username);

  if (!projectPath) {
    sendNotFound(res);
    return;
  }

  if (isReservedAppProjectPath(projectPath)) {
    sendJson(res, 403, { error: "Access denied" });
    return;
  }

  const accessController = createAppAccessController({
    groupIndex: getRuntimeGroupIndex(watchdog, runtimeParams),
    runtimeParams,
    username
  });

  if (!accessController.canReadProjectPath(projectPath)) {
    sendJson(res, 403, { error: "Access denied" });
    return;
  }

  const absolutePath = resolveProjectAbsolutePath(projectRoot, projectPath, runtimeParams);
  sendFile(res, absolutePath);
}

export { handleAppFetchRequest };
