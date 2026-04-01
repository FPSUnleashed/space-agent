import { globToRegExp, normalizePathSegment } from "../utils/app-files.js";
import { parseProjectModuleExtensionFilePath } from "./layout.js";
import { collectAccessibleModuleEntries, selectOverrideEntries } from "./overrides.js";

function normalizeExtensionPattern(value) {
  try {
    return normalizePathSegment(value);
  } catch {
    return "";
  }
}

function compileExtensionPatterns(patterns) {
  return patterns
    .map((pattern) => normalizeExtensionPattern(pattern))
    .filter(Boolean)
    .map((pattern) => ({
      matcher: globToRegExp(pattern),
      pattern
    }));
}

function matchesExtensionPattern(entry, compiledPatterns) {
  return compiledPatterns.some(({ matcher }) => matcher.test(entry.extensionPath));
}

function listResolvedExtensionRequestPaths(options = {}) {
  const { patterns = [], username, watchdog } = options;

  if (!watchdog || typeof watchdog.getPaths !== "function") {
    return [];
  }

  const compiledPatterns = compileExtensionPatterns(patterns);

  if (compiledPatterns.length === 0) {
    return [];
  }

  const accessibleEntries = collectAccessibleModuleEntries(watchdog.getPaths(), {
    groupIndex: typeof watchdog.getIndex === "function" ? watchdog.getIndex("group-index") : null,
    parseProjectPath: parseProjectModuleExtensionFilePath,
    username
  }).filter((entry) => matchesExtensionPattern(entry, compiledPatterns));

  return selectOverrideEntries(accessibleEntries, {
    getOverrideKey(entry) {
      return entry.requestPath;
    }
  }).map((entry) => entry.requestPath);
}

export { listResolvedExtensionRequestPaths };
