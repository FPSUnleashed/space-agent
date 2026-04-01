import path from "node:path";

import { resolveInheritedModuleProjectPath } from "../lib/customware/module-inheritance.js";
import { toProjectPath } from "../lib/file-watch/watchdog.js";
import { sendFile, sendNotFound } from "./responses.js";

function resolveModuleFilePath(projectRoot, requestPath, username, watchdog) {
  const normalizedPath = path.posix.normalize(requestPath);

  if (!normalizedPath.startsWith("/mod/")) {
    return "";
  }

  const resolvedModulePath = resolveInheritedModuleProjectPath({
    projectRoot,
    requestPath: normalizedPath,
    username,
    watchdog
  });

  return resolvedModulePath ? resolvedModulePath.absolutePath : "";
}

function handleModuleRequest(res, requestPath, options = {}) {
  const { projectRoot, username, watchdog } = options;
  const filePath = resolveModuleFilePath(projectRoot, requestPath, username, watchdog);

  if (!filePath) {
    sendNotFound(res);
    return;
  }

  const projectPath = projectRoot ? toProjectPath(projectRoot, filePath) : "";
  const knownMissing = Boolean(watchdog && projectPath && watchdog.covers(projectPath) && !watchdog.hasPath(projectPath));

  sendFile(res, filePath, {
    knownMissing
  });
}

export { handleModuleRequest };
