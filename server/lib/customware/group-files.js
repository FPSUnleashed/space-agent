import fs from "node:fs";
import path from "node:path";

import { normalizeEntityId } from "./layout.js";
import { parseSimpleYaml, serializeSimpleYaml } from "../utils/yaml-lite.js";

function normalizeLayer(value) {
  const layer = String(value || "L1").trim().toUpperCase();
  return layer === "L0" || layer === "L1" ? layer : "";
}

function normalizeStringList(values) {
  return [...new Set((Array.isArray(values) ? values : values ? [values] : [])
    .map((value) => normalizeEntityId(value))
    .filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
}

function getNormalizedGroupConfig(config = {}) {
  return {
    included_groups: normalizeStringList(config.included_groups),
    included_users: normalizeStringList(config.included_users),
    managing_groups: normalizeStringList(config.managing_groups),
    managing_users: normalizeStringList(config.managing_users)
  };
}

function buildGroupConfigAbsolutePath(projectRoot, layer, groupId) {
  const normalizedLayer = normalizeLayer(layer);
  const normalizedGroupId = normalizeEntityId(groupId);

  if (!normalizedLayer) {
    throw new Error(`Invalid group layer: ${String(layer || "")}`);
  }

  if (!normalizedGroupId) {
    throw new Error(`Invalid group id: ${String(groupId || "")}`);
  }

  return path.join(projectRoot, "app", normalizedLayer, normalizedGroupId, "group.yaml");
}

function readGroupConfig(projectRoot, layer, groupId) {
  const filePath = buildGroupConfigAbsolutePath(projectRoot, layer, groupId);

  try {
    return parseSimpleYaml(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") {
      return {};
    }

    throw error;
  }
}

function writeGroupConfig(projectRoot, layer, groupId, config) {
  const filePath = buildGroupConfigAbsolutePath(projectRoot, layer, groupId);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(
    filePath,
    serializeSimpleYaml(getNormalizedGroupConfig(config)),
    "utf8"
  );
  return filePath;
}

function createGroup(projectRoot, layer, groupId, options = {}) {
  const groupDir = path.dirname(buildGroupConfigAbsolutePath(projectRoot, layer, groupId));

  if (fs.existsSync(groupDir)) {
    if (!options.force) {
      throw new Error(`Group already exists: ${normalizeEntityId(groupId)}`);
    }

    fs.rmSync(groupDir, { force: true, recursive: true });
  }

  fs.mkdirSync(path.join(groupDir, "mod"), { recursive: true });
  writeGroupConfig(projectRoot, layer, groupId, {});

  return {
    groupDir,
    groupId: normalizeEntityId(groupId),
    layer: normalizeLayer(layer)
  };
}

function addGroupEntry(projectRoot, layer, groupId, entryType, entryId, options = {}) {
  const config = readGroupConfig(projectRoot, layer, groupId);
  const normalizedEntryType = String(entryType || "").trim().toLowerCase();
  const key =
    normalizedEntryType === "group"
      ? options.manager
        ? "managing_groups"
        : "included_groups"
      : normalizedEntryType === "user"
        ? options.manager
          ? "managing_users"
          : "included_users"
        : "";

  if (!key) {
    throw new Error(`Unsupported group entry type: ${String(entryType || "")}`);
  }

  return writeGroupConfig(projectRoot, layer, groupId, {
    ...config,
    [key]: normalizeStringList([...(config[key] || []), entryId])
  });
}

function removeGroupEntry(projectRoot, layer, groupId, entryType, entryId, options = {}) {
  const normalizedEntryId = normalizeEntityId(entryId);
  const config = readGroupConfig(projectRoot, layer, groupId);
  const normalizedEntryType = String(entryType || "").trim().toLowerCase();
  const key =
    normalizedEntryType === "group"
      ? options.manager
        ? "managing_groups"
        : "included_groups"
      : normalizedEntryType === "user"
        ? options.manager
          ? "managing_users"
          : "included_users"
        : "";

  if (!key) {
    throw new Error(`Unsupported group entry type: ${String(entryType || "")}`);
  }

  const nextValues = normalizeStringList(config[key]).filter(
    (existingEntryId) => existingEntryId !== normalizedEntryId
  );

  return writeGroupConfig(projectRoot, layer, groupId, {
    ...config,
    [key]: nextValues
  });
}

export {
  buildGroupConfigAbsolutePath,
  createGroup,
  getNormalizedGroupConfig,
  normalizeLayer,
  readGroupConfig,
  addGroupEntry,
  removeGroupEntry,
  writeGroupConfig
};
