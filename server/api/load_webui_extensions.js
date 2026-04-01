import { normalizePathSegment } from "../lib/utils/app-files.js";
import { listResolvedExtensionRequestPaths } from "../lib/customware/extension-overrides.js";

function readPayload(context) {
  if (!context.body || typeof context.body !== "object" || Buffer.isBuffer(context.body)) {
    return {};
  }

  return context.body;
}

function readRequestedPatterns(context) {
  const payload = readPayload(context);
  const normalizePattern = (value) => {
    try {
      return normalizePathSegment(value);
    } catch {
      return "";
    }
  };

  if (Array.isArray(payload.patterns)) {
    return payload.patterns
      .filter((value) => typeof value === "string")
      .map((value) => normalizePattern(value))
      .filter(Boolean);
  }

  const extensionPoint = normalizePathSegment(payload.extension_point || "");
  const filters = Array.isArray(payload.filters)
    ? payload.filters.filter((value) => typeof value === "string" && value.trim())
    : [];

  if (!extensionPoint) {
    return [];
  }

  return (filters.length > 0 ? filters : ["*"]).map((filter) =>
    normalizePattern(`${extensionPoint}/${filter}`)
  ).filter(Boolean);
}

export function post(context) {
  const patterns = readRequestedPatterns(context);
  const extensions = listResolvedExtensionRequestPaths({
    patterns,
    username: context.user && context.user.username,
    watchdog: context.watchdog
  });

  return {
    extensions
  };
}
