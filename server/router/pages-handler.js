import path from "node:path";

import { sendFile, sendJson, sendNotFound, sendRedirect } from "./responses.js";

const LEGACY_ROUTE_REDIRECTS = new Map([
  ["/index.html", "/"],
  ["/login.html", "/login"],
  ["/admin.html", "/admin"]
]);

const LOGOUT_ROUTE = "/logout";

function createSessionCleanupHeaders(requestContext, auth) {
  if (
    requestContext?.user?.shouldClearSessionCookie &&
    auth &&
    typeof auth.createClearedSessionCookieHeader === "function"
  ) {
    return {
      "Set-Cookie": auth.createClearedSessionCookieHeader()
    };
  }

  return {};
}

function createClearedSessionHeaders(auth) {
  if (auth && typeof auth.createClearedSessionCookieHeader === "function") {
    return {
      "Set-Cookie": auth.createClearedSessionCookieHeader()
    };
  }

  return {};
}

async function handleLogoutRequest(res, options = {}) {
  const { auth, requestContext } = options;

  try {
    if (
      requestContext?.user?.isAuthenticated &&
      auth &&
      typeof auth.revokeSession === "function"
    ) {
      await auth.revokeSession(requestContext.user.sessionToken, requestContext.user.username);
    }
  } catch {
    sendJson(res, 500, {
      error: "Internal server error"
    });
    return;
  }

  sendRedirect(res, "/login", createClearedSessionHeaders(auth));
}

function resolvePathWithinRoot(rootDir, requestPath) {
  const filePath = path.resolve(rootDir, `.${requestPath}`);
  const relativePath = path.relative(rootDir, filePath);

  if (
    relativePath === "" ||
    relativePath === "." ||
    relativePath.startsWith("..") ||
    path.isAbsolute(relativePath)
  ) {
    return null;
  }

  return filePath;
}

function resolvePageRequest(pagesDir, pathname) {
  const normalizedPath = path.posix.normalize(pathname || "/");

  if (LEGACY_ROUTE_REDIRECTS.has(normalizedPath)) {
    return {
      kind: "redirect",
      location: LEGACY_ROUTE_REDIRECTS.get(normalizedPath)
    };
  }

  if (normalizedPath !== "/" && normalizedPath.endsWith("/")) {
    return {
      kind: "redirect",
      location: normalizedPath.slice(0, -1)
    };
  }

  const pageName =
    normalizedPath === "/"
      ? "index.html"
      : normalizedPath.match(/^\/([a-z0-9_-]+)$/i)?.[1]
        ? `${normalizedPath.slice(1)}.html`
        : "";

  if (!pageName) {
    return null;
  }

  return {
    filePath: resolvePathWithinRoot(pagesDir, `/${pageName}`),
    kind: "file",
    pageName
  };
}

async function handlePageRequest(res, requestUrl, options = {}) {
  const { auth, pagesDir, requestContext } = options;

  if (requestUrl.pathname === LOGOUT_ROUTE) {
    await handleLogoutRequest(res, options);
    return;
  }

  const pageRequest = resolvePageRequest(pagesDir, requestUrl.pathname);

  if (!pageRequest) {
    sendNotFound(res);
    return;
  }

  if (pageRequest.kind === "redirect") {
    sendRedirect(res, pageRequest.location, createSessionCleanupHeaders(requestContext, auth));
    return;
  }

  const isLoginPage = pageRequest.pageName === "login.html";

  if (isLoginPage && requestContext?.user?.isAuthenticated) {
    sendRedirect(res, "/", createSessionCleanupHeaders(requestContext, auth));
    return;
  }

  if (!isLoginPage && !requestContext?.user?.isAuthenticated) {
    sendRedirect(res, "/login", createSessionCleanupHeaders(requestContext, auth));
    return;
  }

  if (!pageRequest.filePath) {
    sendNotFound(res);
    return;
  }

  sendFile(res, pageRequest.filePath, {
    headers: createSessionCleanupHeaders(requestContext, auth)
  });
}

export { handlePageRequest };
