import { normalizePathSegment } from "../utils/app-files.js";

function normalizeEntityId(value) {
  const normalized = normalizePathSegment(value);

  if (!normalized || normalized.includes("/")) {
    return "";
  }

  return normalized;
}

function normalizeModuleRequestPath(value) {
  const normalized = normalizePathSegment(value);

  if (!normalized.startsWith("mod/")) {
    return "";
  }

  return `/${normalized}`;
}

function parseModuleExtensionRequestPath(requestPath) {
  const match = String(requestPath || "").match(/^\/mod\/([^/]+)\/([^/]+)\/ext\/(.+)$/u);

  if (!match) {
    return null;
  }

  const authorId = normalizeEntityId(match[1]);
  const repositoryId = normalizeEntityId(match[2]);
  const extensionPath = normalizePathSegment(match[3]);

  if (!authorId || !repositoryId || !extensionPath) {
    return null;
  }

  return {
    authorId,
    extensionPath,
    moduleRequestPath: `/mod/${authorId}/${repositoryId}`,
    repositoryId,
    requestPath: `/mod/${authorId}/${repositoryId}/ext/${extensionPath}`
  };
}

function parseProjectModuleFilePath(projectPath) {
  let match = String(projectPath || "").match(/^\/app\/L0\/([^/]+)\/(mod\/.+)$/u);

  if (match) {
    const ownerId = normalizeEntityId(match[1]);

    if (!ownerId) {
      return null;
    }

    return {
      layer: "L0",
      ownerId,
      ownerType: "group",
      projectPath: String(projectPath),
      requestPath: `/${match[2]}`
    };
  }

  match = String(projectPath || "").match(/^\/app\/L1\/([^/]+)\/(mod\/.+)$/u);

  if (match) {
    const ownerId = normalizeEntityId(match[1]);

    if (!ownerId) {
      return null;
    }

    return {
      layer: "L1",
      ownerId,
      ownerType: "group",
      projectPath: String(projectPath),
      requestPath: `/${match[2]}`
    };
  }

  match = String(projectPath || "").match(/^\/app\/L2\/([^/]+)\/(mod\/.+)$/u);

  if (match) {
    const ownerId = normalizeEntityId(match[1]);

    if (!ownerId) {
      return null;
    }

    return {
      layer: "L2",
      ownerId,
      ownerType: "user",
      projectPath: String(projectPath),
      requestPath: `/${match[2]}`
    };
  }

  return null;
}

function parseProjectModuleExtensionFilePath(projectPath) {
  if (String(projectPath || "").endsWith("/")) {
    return null;
  }

  const modulePathInfo = parseProjectModuleFilePath(projectPath);

  if (!modulePathInfo) {
    return null;
  }

  const extensionRequestPathInfo = parseModuleExtensionRequestPath(modulePathInfo.requestPath);

  if (!extensionRequestPathInfo) {
    return null;
  }

  return {
    ...modulePathInfo,
    ...extensionRequestPathInfo,
    projectPath: String(projectPath)
  };
}

function parseGroupConfigProjectPath(projectPath) {
  let match = String(projectPath || "").match(/^\/app\/L0\/([^/]+)\/group\.yaml$/u);

  if (match) {
    const groupId = normalizeEntityId(match[1]);

    if (!groupId) {
      return null;
    }

    return {
      groupId,
      layer: "L0",
      projectPath: String(projectPath)
    };
  }

  match = String(projectPath || "").match(/^\/app\/L1\/([^/]+)\/group\.yaml$/u);

  if (match) {
    const groupId = normalizeEntityId(match[1]);

    if (!groupId) {
      return null;
    }

    return {
      groupId,
      layer: "L1",
      projectPath: String(projectPath)
    };
  }

  return null;
}

function parseProjectUserDirectoryPath(projectPath) {
  const match = String(projectPath || "").match(/^\/app\/L2\/([^/]+)\/$/u);

  if (!match) {
    return null;
  }

  const username = normalizeEntityId(match[1]);

  if (!username) {
    return null;
  }

  return {
    layer: "L2",
    projectPath: String(projectPath),
    username
  };
}

function parseProjectUserConfigPath(projectPath) {
  const match = String(projectPath || "").match(/^\/app\/L2\/([^/]+)\/user\.yaml$/u);

  if (!match) {
    return null;
  }

  const username = normalizeEntityId(match[1]);

  if (!username) {
    return null;
  }

  return {
    layer: "L2",
    projectPath: String(projectPath),
    username
  };
}

function parseProjectUserLoginsPath(projectPath) {
  const match = String(projectPath || "").match(/^\/app\/L2\/([^/]+)\/logins\.json$/u);

  if (!match) {
    return null;
  }

  const username = normalizeEntityId(match[1]);

  if (!username) {
    return null;
  }

  return {
    layer: "L2",
    projectPath: String(projectPath),
    username
  };
}

export {
  normalizeEntityId,
  normalizeModuleRequestPath,
  parseModuleExtensionRequestPath,
  parseGroupConfigProjectPath,
  parseProjectModuleExtensionFilePath,
  parseProjectModuleFilePath,
  parseProjectUserConfigPath,
  parseProjectUserDirectoryPath,
  parseProjectUserLoginsPath
};
