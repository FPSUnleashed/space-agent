import { randomBytes } from "node:crypto";

import { normalizeEntityId } from "../customware/layout.js";
import { createEmptyUserIndex } from "./user-index.js";
import { verifyLoginProof } from "./passwords.js";
import { readUserLogins, writeUserLogins } from "./user-files.js";

const SESSION_COOKIE_NAME = "agent_one_session";
const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const NONCE_PATTERN = /^[A-Za-z0-9_-]{16,200}$/u;

function createAnonymousUser(overrides = {}) {
  return {
    isAuthenticated: false,
    session: null,
    sessionToken: "",
    shouldClearSessionCookie: false,
    source: "anonymous",
    username: "",
    ...overrides
  };
}

function serializeCookie(name, value, attributes = {}) {
  const segments = [`${name}=${encodeURIComponent(String(value || ""))}`];

  Object.entries(attributes).forEach(([key, rawValue]) => {
    if (rawValue === false || rawValue === undefined || rawValue === null) {
      return;
    }

    if (rawValue === true) {
      segments.push(key);
      return;
    }

    segments.push(`${key}=${rawValue}`);
  });

  return segments.join("; ");
}

function createSessionCookieHeader(sessionToken) {
  return serializeCookie(SESSION_COOKIE_NAME, sessionToken, {
    HttpOnly: true,
    Path: "/",
    SameSite: "Strict"
  });
}

function createClearedSessionCookieHeader() {
  return serializeCookie(SESSION_COOKIE_NAME, "", {
    HttpOnly: true,
    "Max-Age": 0,
    Path: "/",
    SameSite: "Strict"
  });
}

function normalizeNonce(value) {
  const nonce = String(value || "").trim();
  return NONCE_PATTERN.test(nonce) ? nonce : "";
}

function createChallengeToken() {
  return randomBytes(24).toString("base64url");
}

function createSessionToken() {
  return randomBytes(32).toString("base64url");
}

function cleanupExpiredChallenges(challenges) {
  const now = Date.now();

  for (const [challengeToken, challenge] of challenges.entries()) {
    if (now - Number(challenge.createdAtMs || 0) > CHALLENGE_TTL_MS) {
      challenges.delete(challengeToken);
    }
  }
}

function getRemoteAddress(req) {
  const forwardedFor = String(req?.headers?.["x-forwarded-for"] || "").split(",")[0].trim();
  return forwardedFor || String(req?.socket?.remoteAddress || "");
}

export function createAuthService(options = {}) {
  const projectRoot = String(options.projectRoot || "");
  const watchdog = options.watchdog || null;
  const challenges = new Map();
  // TODO: Replace this local file-backed session store with the future full auth system,
  // including guest users, explicit session expiry/revocation policy, and browser binding
  // that is stronger than the current localhost-oriented compromise.

  function getUserIndex() {
    if (!watchdog || typeof watchdog.getIndex !== "function") {
      return createEmptyUserIndex();
    }

    return watchdog.getIndex("user-index") || createEmptyUserIndex();
  }

  function resolveUserFromCookies(cookies = {}) {
    const sessionToken = String(cookies[SESSION_COOKIE_NAME] || "").trim();

    if (!sessionToken) {
      return createAnonymousUser();
    }

    const userIndex = getUserIndex();
    const session = userIndex.getSession(sessionToken);

    if (!session) {
      return createAnonymousUser({
        sessionToken,
        shouldClearSessionCookie: true,
        source: "invalid-session-cookie"
      });
    }

    const username = normalizeEntityId(session.username);
    const userRecord = userIndex.getUser(username);

    if (!username || !userRecord) {
      return createAnonymousUser({
        sessionToken,
        shouldClearSessionCookie: true,
        source: "stale-session-cookie"
      });
    }

    return {
      isAuthenticated: true,
      session,
      sessionToken,
      shouldClearSessionCookie: false,
      source: "session-cookie",
      username
    };
  }

  function createLoginChallenge({ req, username, clientNonce }) {
    cleanupExpiredChallenges(challenges);

    const normalizedUsername = normalizeEntityId(username);
    const normalizedClientNonce = normalizeNonce(clientNonce);
    const userIndex = getUserIndex();
    const userRecord = userIndex.getUser(normalizedUsername);

    if (!normalizedUsername || !normalizedClientNonce || !userRecord || !userRecord.verifier) {
      throw new Error("Invalid username or password.");
    }

    const challengeToken = createChallengeToken();
    const serverNonce = createChallengeToken();
    const createdAtMs = Date.now();

    challenges.set(challengeToken, {
      clientNonce: normalizedClientNonce,
      createdAtMs,
      remoteAddress: getRemoteAddress(req),
      serverNonce,
      userAgent: String(req?.headers?.["user-agent"] || ""),
      username: normalizedUsername
    });

    return {
      challengeToken,
      iterations: Number(userRecord.verifier.iterations),
      passwordScheme: userRecord.verifier.scheme,
      salt: userRecord.verifier.salt,
      serverNonce
    };
  }

  async function completeLogin({ challengeToken, clientProof, req }) {
    cleanupExpiredChallenges(challenges);

    const normalizedChallengeToken = String(challengeToken || "").trim();
    const challenge = challenges.get(normalizedChallengeToken);

    if (!challenge) {
      throw new Error("Login challenge expired. Try again.");
    }

    challenges.delete(normalizedChallengeToken);

    const userIndex = getUserIndex();
    const userRecord = userIndex.getUser(challenge.username);

    if (!userRecord || !userRecord.verifier) {
      throw new Error("Invalid username or password.");
    }

    if (challenge.userAgent && challenge.userAgent !== String(req?.headers?.["user-agent"] || "")) {
      throw new Error("Login challenge no longer matches this browser.");
    }

    const loginResult = verifyLoginProof({
      challengeToken: normalizedChallengeToken,
      clientNonce: challenge.clientNonce,
      clientProof,
      serverNonce: challenge.serverNonce,
      username: challenge.username,
      verifier: userRecord.verifier
    });

    if (!loginResult.ok) {
      throw new Error("Invalid username or password.");
    }

    const sessionToken = createSessionToken();
    const logins = readUserLogins(projectRoot, challenge.username);

    logins[sessionToken] = {
      createdAt: new Date().toISOString(),
      remoteAddress: getRemoteAddress(req),
      userAgent: String(req?.headers?.["user-agent"] || "")
    };

    writeUserLogins(projectRoot, challenge.username, logins);

    if (watchdog && typeof watchdog.refresh === "function") {
      await watchdog.refresh();
    }

    return {
      serverSignature: loginResult.serverSignature,
      sessionToken,
      username: challenge.username
    };
  }

  async function revokeSession(sessionToken, username = "") {
    const normalizedSessionToken = String(sessionToken || "").trim();
    const normalizedUsername = normalizeEntityId(username);

    if (!normalizedSessionToken || !normalizedUsername) {
      return false;
    }

    const logins = readUserLogins(projectRoot, normalizedUsername);

    if (!Object.prototype.hasOwnProperty.call(logins, normalizedSessionToken)) {
      return false;
    }

    delete logins[normalizedSessionToken];
    writeUserLogins(projectRoot, normalizedUsername, logins);

    if (watchdog && typeof watchdog.refresh === "function") {
      await watchdog.refresh();
    }

    return true;
  }

  function getAuthenticatedUser(requestUser) {
    if (requestUser && requestUser.isAuthenticated) {
      return requestUser;
    }

    throw new Error("Authentication required.");
  }

  return {
    completeLogin,
    createClearedSessionCookieHeader,
    createLoginChallenge,
    createSessionCookieHeader,
    getAuthenticatedUser,
    getUserIndex,
    revokeSession,
    resolveUserFromCookies
  };
}

export {
  CHALLENGE_TTL_MS,
  SESSION_COOKIE_NAME,
  createClearedSessionCookieHeader,
  createSessionCookieHeader
};
