import { createHttpError } from "../lib/customware/file_access.js";
import { revertLayerHistoryCommit } from "../lib/customware/git_history.js";

function readPayload(context) {
  return context.body && typeof context.body === "object" && !Buffer.isBuffer(context.body)
    ? context.body
    : {};
}

function readPath(context) {
  const payload = readPayload(context);
  return String(payload.path || context.params.path || "~");
}

function readCommitHash(context) {
  const payload = readPayload(context);

  return String(
    payload.commitHash ||
      payload.commit ||
      payload.hash ||
      context.params.commitHash ||
      context.params.commit ||
      context.params.hash ||
      ""
  );
}

async function refreshWatchdog(context) {
  if (context.watchdog && typeof context.watchdog.refresh === "function") {
    await context.watchdog.refresh();
  }
}

export async function post(context) {
  try {
    const result = await revertLayerHistoryCommit({
      commitHash: readCommitHash(context),
      path: readPath(context),
      projectRoot: context.projectRoot,
      runtimeParams: context.runtimeParams,
      username: context.user?.username,
      watchdog: context.watchdog
    });

    await refreshWatchdog(context);

    return result;
  } catch (error) {
    throw createHttpError(error.message || "Git history revert failed.", Number(error.statusCode) || 500);
  }
}
