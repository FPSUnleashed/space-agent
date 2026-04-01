import fs from "node:fs";
import path from "node:path";

import {
  parseProjectUserConfigPath,
  parseProjectUserDirectoryPath,
  parseProjectUserLoginsPath
} from "../customware/layout.js";
import { parseSimpleYaml } from "../utils/yaml-lite.js";
import { normalizeVerifierRecord } from "./passwords.js";

function createEmptyUserRecord(username) {
  return {
    hasPassword: false,
    loginsPath: "",
    projectDir: "",
    sessions: [],
    userConfigPath: "",
    username,
    verifier: null
  };
}

function createEmptyUserIndex() {
  return {
    errors: [],
    getSession() {
      return null;
    },
    getUser() {
      return null;
    },
    hasUser() {
      return false;
    },
    sessions: Object.create(null),
    users: Object.create(null)
  };
}

function ensureUser(users, username) {
  if (!users[username]) {
    users[username] = createEmptyUserRecord(username);
  }

  return users[username];
}

function readJsonObject(filePath) {
  try {
    const sourceText = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(sourceText);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch (error) {
    if (error.code === "ENOENT") {
      return {};
    }

    throw error;
  }
}

function buildUserIndexSnapshot(context = {}) {
  const filePaths = Array.isArray(context.filePaths) ? context.filePaths : [];
  const projectRoot = String(context.projectRoot || "");
  const users = Object.create(null);
  const sessions = Object.create(null);
  const errors = [];

  filePaths.forEach((projectPath) => {
    const userDirectoryInfo = parseProjectUserDirectoryPath(projectPath);

    if (userDirectoryInfo) {
      ensureUser(users, userDirectoryInfo.username).projectDir = projectPath;
    }
  });

  filePaths.forEach((projectPath) => {
    const userConfigInfo = parseProjectUserConfigPath(projectPath);

    if (!userConfigInfo) {
      return;
    }

    const userRecord = ensureUser(users, userConfigInfo.username);
    userRecord.userConfigPath = projectPath;

    try {
      const absolutePath = path.join(projectRoot, projectPath.slice(1));
      const parsedConfig = parseSimpleYaml(fs.readFileSync(absolutePath, "utf8"));
      const verifier = normalizeVerifierRecord(parsedConfig);
      userRecord.verifier = verifier;
      userRecord.hasPassword = Boolean(verifier);

      if (!verifier) {
        errors.push({
          message: "Ignored invalid user.yaml password verifier.",
          projectPath
        });
      }
    } catch (error) {
      errors.push({
        message: `Failed to parse user.yaml: ${error.message}`,
        projectPath
      });
    }
  });

  filePaths.forEach((projectPath) => {
    const userLoginsInfo = parseProjectUserLoginsPath(projectPath);

    if (!userLoginsInfo) {
      return;
    }

    const userRecord = ensureUser(users, userLoginsInfo.username);
    userRecord.loginsPath = projectPath;

    let parsedLogins = {};

    try {
      const absolutePath = path.join(projectRoot, projectPath.slice(1));
      parsedLogins = readJsonObject(absolutePath);
    } catch (error) {
      errors.push({
        message: `Failed to parse logins.json: ${error.message}`,
        projectPath
      });
      return;
    }

    Object.entries(parsedLogins).forEach(([sessionToken, details]) => {
      const normalizedToken = String(sessionToken || "").trim();

      if (!normalizedToken) {
        return;
      }

      if (sessions[normalizedToken]) {
        errors.push({
          message: "Ignored duplicate session token across users.",
          projectPath,
          sessionToken: normalizedToken
        });
        return;
      }

      const sessionDetails =
        details && typeof details === "object" && !Array.isArray(details) ? { ...details } : {};

      const sessionRecord = {
        ...sessionDetails,
        loginsPath: projectPath,
        sessionToken: normalizedToken,
        username: userLoginsInfo.username
      };

      sessions[normalizedToken] = sessionRecord;
      userRecord.sessions.push(sessionRecord);
    });
  });

  Object.values(users).forEach((userRecord) => {
    userRecord.sessions.sort((left, right) =>
      String(left.sessionToken || "").localeCompare(String(right.sessionToken || ""))
    );
  });

  return {
    errors,
    getSession(sessionToken) {
      const normalizedToken = String(sessionToken || "").trim();
      return normalizedToken ? sessions[normalizedToken] || null : null;
    },
    getUser(username) {
      const normalizedUsername = String(username || "").trim();
      return normalizedUsername ? users[normalizedUsername] || null : null;
    },
    hasUser(username) {
      return Boolean(this.getUser(username));
    },
    sessions,
    users
  };
}

export { buildUserIndexSnapshot, createEmptyUserIndex };
