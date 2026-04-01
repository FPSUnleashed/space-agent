export const allowAnonymous = true;

const LOGIN_MIN_DURATION_MS = 500;

function createHttpError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function waitForMinimumDuration(startedAtMs, minimumDurationMs) {
  const elapsedMs = Date.now() - startedAtMs;

  if (elapsedMs < minimumDurationMs) {
    await wait(minimumDurationMs - elapsedMs);
  }
}

export async function post(context) {
  const startedAtMs = Date.now();
  const payload =
    context.body && typeof context.body === "object" && !Buffer.isBuffer(context.body)
      ? context.body
      : {};
  let response;

  try {
    const loginResult = await context.auth.completeLogin({
      challengeToken: payload.challengeToken,
      clientProof: payload.clientProof,
      req: context.req
    });

    response = {
      status: 200,
      headers: {
        "Cache-Control": "no-store",
        "Set-Cookie": context.auth.createSessionCookieHeader(loginResult.sessionToken)
      },
      body: {
        authenticated: true,
        serverSignature: loginResult.serverSignature,
        username: loginResult.username
      }
    };
  } catch (error) {
    await waitForMinimumDuration(startedAtMs, LOGIN_MIN_DURATION_MS);
    throw createHttpError(error.message || "Login failed.", 401);
  }

  await waitForMinimumDuration(startedAtMs, LOGIN_MIN_DURATION_MS);
  return response;
}
