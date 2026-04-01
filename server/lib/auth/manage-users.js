import fs from "node:fs";

import { createPasswordVerifier } from "./passwords.js";
import {
  buildUserAbsolutePath,
  ensureUserStructure,
  normalizeUsername,
  readUserConfig,
  writeUserConfig,
  writeUserLogins
} from "./user-files.js";

function removeLegacyPasswordFields(config = {}) {
  const {
    password_iterations: _passwordIterations,
    password_salt: _passwordSalt,
    password_scheme: _passwordScheme,
    password_server_key: _passwordServerKey,
    password_stored_key: _passwordStoredKey,
    ...rest
  } = config;

  return rest;
}

function createUser(projectRoot, username, password, options = {}) {
  const normalizedUsername = normalizeUsername(username);

  if (!normalizedUsername) {
    throw new Error(`Invalid username: ${String(username || "")}`);
  }

  const userDir = buildUserAbsolutePath(projectRoot, normalizedUsername);

  if (fs.existsSync(userDir)) {
    if (!options.force) {
      throw new Error(`User already exists: ${normalizedUsername}`);
    }

    fs.rmSync(userDir, { force: true, recursive: true });
  }

  ensureUserStructure(projectRoot, normalizedUsername);
  writeUserConfig(projectRoot, normalizedUsername, {
    password: createPasswordVerifier(password)
  });
  writeUserLogins(projectRoot, normalizedUsername, {});

  return {
    userDir,
    username: normalizedUsername
  };
}

function setUserPassword(projectRoot, username, password) {
  const normalizedUsername = normalizeUsername(username);

  if (!normalizedUsername) {
    throw new Error(`Invalid username: ${String(username || "")}`);
  }

  const currentConfig = readUserConfig(projectRoot, normalizedUsername);
  const userDir = buildUserAbsolutePath(projectRoot, normalizedUsername);

  if (!fs.existsSync(userDir)) {
    throw new Error(`User does not exist: ${normalizedUsername}`);
  }

  ensureUserStructure(projectRoot, normalizedUsername);

  writeUserConfig(projectRoot, normalizedUsername, {
    ...removeLegacyPasswordFields(currentConfig),
    password: createPasswordVerifier(password)
  });
  writeUserLogins(projectRoot, normalizedUsername, {});

  return {
    userDir,
    username: normalizedUsername
  };
}

export { createUser, setUserPassword };
