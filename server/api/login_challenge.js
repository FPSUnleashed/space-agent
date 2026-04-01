export const allowAnonymous = true;

function createHttpError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

export function post(context) {
  const payload =
    context.body && typeof context.body === "object" && !Buffer.isBuffer(context.body)
      ? context.body
      : {};

  try {
    return context.auth.createLoginChallenge({
      clientNonce: payload.clientNonce,
      req: context.req,
      username: payload.username
    });
  } catch (error) {
    throw createHttpError(error.message || "Login challenge failed.", 401);
  }
}
