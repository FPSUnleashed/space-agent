import { createHash, createHmac, pbkdf2Sync, randomBytes, timingSafeEqual } from "node:crypto";

const PASSWORD_SCHEME = "scram-sha-256";
const PASSWORD_HASH = "sha256";
const PASSWORD_ITERATIONS = 310_000;
const PASSWORD_KEY_LENGTH = 32;
const CLIENT_KEY_LABEL = "Client Key";
const SERVER_KEY_LABEL = "Server Key";
const LOGIN_AUTH_MESSAGE_PREFIX = "agent-one-login-v1";

function encodeBase64Url(value) {
  return Buffer.from(value).toString("base64url");
}

function decodeBase64Url(value) {
  return Buffer.from(String(value || ""), "base64url");
}

function sha256(value) {
  return createHash(PASSWORD_HASH).update(value).digest();
}

function hmacSha256(key, value) {
  return createHmac(PASSWORD_HASH, key).update(value).digest();
}

function xorBuffers(left, right) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    throw new Error("Cannot xor buffers of different lengths.");
  }

  const output = Buffer.allocUnsafe(leftBuffer.length);

  for (let index = 0; index < leftBuffer.length; index += 1) {
    output[index] = leftBuffer[index] ^ rightBuffer[index];
  }

  return output;
}

function normalizeIterations(value) {
  const iterations = Number(value);
  return Number.isInteger(iterations) && iterations > 0 ? iterations : 0;
}

function normalizeVerifierRecord(record) {
  if (!record || typeof record !== "object") {
    return null;
  }

  const source =
    record.password && typeof record.password === "object" && !Array.isArray(record.password)
      ? record.password
      : record;
  const scheme = String(source.password_scheme || source.scheme || PASSWORD_SCHEME).trim().toLowerCase();
  const salt = String(source.password_salt || source.salt || "").trim();
  const iterations = normalizeIterations(source.password_iterations || source.iterations);
  const storedKey = String(
    source.password_stored_key || source.stored_key || source.storedKey || ""
  ).trim();
  const serverKey = String(
    source.password_server_key || source.server_key || source.serverKey || ""
  ).trim();

  if (
    scheme !== PASSWORD_SCHEME ||
    !salt ||
    !iterations ||
    !storedKey ||
    !serverKey
  ) {
    return null;
  }

  return {
    iterations,
    salt,
    scheme,
    serverKey,
    storedKey
  };
}

function deriveSaltedPassword(password, salt, iterations) {
  return pbkdf2Sync(String(password || ""), decodeBase64Url(salt), iterations, PASSWORD_KEY_LENGTH, PASSWORD_HASH);
}

function createPasswordVerifier(password, options = {}) {
  const iterations = normalizeIterations(options.iterations) || PASSWORD_ITERATIONS;
  const salt = options.salt ? String(options.salt) : encodeBase64Url(randomBytes(16));
  const saltedPassword = deriveSaltedPassword(password, salt, iterations);
  const clientKey = hmacSha256(saltedPassword, CLIENT_KEY_LABEL);
  const storedKey = sha256(clientKey);
  const serverKey = hmacSha256(saltedPassword, SERVER_KEY_LABEL);

  return {
    iterations: String(iterations),
    salt,
    scheme: PASSWORD_SCHEME,
    server_key: encodeBase64Url(serverKey),
    stored_key: encodeBase64Url(storedKey)
  };
}

function buildLoginAuthMessage({ challengeToken, clientNonce, serverNonce, username }) {
  return [
    LOGIN_AUTH_MESSAGE_PREFIX,
    String(username || ""),
    String(clientNonce || ""),
    String(serverNonce || ""),
    String(challengeToken || "")
  ].join(":");
}

function verifyLoginProof(options = {}) {
  const verifier = normalizeVerifierRecord(options.verifier);

  if (!verifier) {
    return {
      ok: false,
      serverSignature: ""
    };
  }

  let storedKey;
  let serverKey;
  let clientProof;

  try {
    storedKey = decodeBase64Url(verifier.storedKey);
    serverKey = decodeBase64Url(verifier.serverKey);
    clientProof = decodeBase64Url(options.clientProof);
  } catch {
    return {
      ok: false,
      serverSignature: ""
    };
  }

  if (
    storedKey.length !== PASSWORD_KEY_LENGTH ||
    serverKey.length !== PASSWORD_KEY_LENGTH ||
    clientProof.length !== PASSWORD_KEY_LENGTH
  ) {
    return {
      ok: false,
      serverSignature: ""
    };
  }

  const authMessage = buildLoginAuthMessage(options);
  const clientSignature = hmacSha256(storedKey, authMessage);
  const clientKey = xorBuffers(clientProof, clientSignature);
  const expectedStoredKey = sha256(clientKey);

  if (!timingSafeEqual(expectedStoredKey, storedKey)) {
    return {
      ok: false,
      serverSignature: ""
    };
  }

  return {
    ok: true,
    serverSignature: encodeBase64Url(hmacSha256(serverKey, authMessage))
  };
}

export {
  CLIENT_KEY_LABEL,
  LOGIN_AUTH_MESSAGE_PREFIX,
  PASSWORD_HASH,
  PASSWORD_ITERATIONS,
  PASSWORD_KEY_LENGTH,
  PASSWORD_SCHEME,
  SERVER_KEY_LABEL,
  buildLoginAuthMessage,
  createPasswordVerifier,
  decodeBase64Url,
  encodeBase64Url,
  normalizeVerifierRecord,
  verifyLoginProof
};
