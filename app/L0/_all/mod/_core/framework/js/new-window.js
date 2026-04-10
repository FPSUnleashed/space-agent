const ENTER_TAB_ACCESS_KEY = "space.enter.tab-access";
const INSTALL_KEY = Symbol.for("space.framework.newWindowAccessInstalled");
const ORIGINAL_OPEN_KEY = Symbol.for("space.framework.originalWindowOpen");
const GUARDED_PAGE_PATHS = new Set(["/", "/admin"]);

function hasCurrentTabAccess() {
  try {
    return window.sessionStorage.getItem(ENTER_TAB_ACCESS_KEY) === "1";
  } catch {
    return false;
  }
}

function parseLocalGuardedUrl(candidate) {
  if (typeof candidate !== "string" && !(candidate instanceof URL)) {
    return null;
  }

  const rawValue = String(candidate || "").trim();

  if (!rawValue || rawValue.startsWith("//")) {
    return null;
  }

  let resolvedUrl;

  try {
    resolvedUrl = new URL(rawValue, window.location.href);
  } catch {
    return null;
  }

  if (resolvedUrl.origin !== window.location.origin || !GUARDED_PAGE_PATHS.has(resolvedUrl.pathname)) {
    return null;
  }

  return resolvedUrl;
}

function isBlankTarget(target) {
  return String(target || "_blank").trim().toLowerCase() === "_blank";
}

function stripNoopenerFeatures(features) {
  if (typeof features !== "string" || !features.trim()) {
    return features;
  }

  const keptFeatures = features
    .split(",")
    .map((feature) => feature.trim())
    .filter((feature) => {
      const featureName = feature.split("=", 1)[0].trim().toLowerCase();
      return featureName !== "noopener" && featureName !== "noreferrer";
    });

  return keptFeatures.join(",");
}

function grantChildTabAccess(childWindow) {
  try {
    childWindow.sessionStorage.setItem(ENTER_TAB_ACCESS_KEY, "1");
  } catch {
    // If the browser blocks child storage access, the page-shell guard remains the fallback.
  }
}

function detachChildOpener(childWindow) {
  try {
    childWindow.opener = null;
  } catch {
    // Some browsers expose opener as read-only. The opened URL is same-origin app chrome.
  }
}

function navigateChildWindow(childWindow, targetUrl) {
  try {
    childWindow.location.replace(targetUrl.href);
  } catch {
    childWindow.location.href = targetUrl.href;
  }
}

function openGuardedBlankWindow(originalOpen, targetUrl, target, features) {
  const childWindow = originalOpen.call(window, "about:blank", target || "_blank", stripNoopenerFeatures(features));

  if (!childWindow) {
    return childWindow;
  }

  grantChildTabAccess(childWindow);
  detachChildOpener(childWindow);
  navigateChildWindow(childWindow, targetUrl);
  return childWindow;
}

function shouldHandleAnchorClick(event, anchor, targetUrl) {
  return Boolean(
    anchor
      && targetUrl
      && hasCurrentTabAccess()
      && isBlankTarget(anchor.target)
      && !anchor.hasAttribute("download")
      && !event.defaultPrevented
      && event.button === 0
      && !event.metaKey
      && !event.ctrlKey
      && !event.shiftKey
      && !event.altKey
  );
}

function findClickedAnchor(event) {
  const target = event.target;

  if (!(target instanceof Element)) {
    return null;
  }

  return target.closest("a[target]");
}

function installBlankAnchorHandler(originalOpen) {
  document.addEventListener(
    "click",
    (event) => {
      const anchor = findClickedAnchor(event);
      const targetUrl = anchor ? parseLocalGuardedUrl(anchor.href) : null;

      if (!shouldHandleAnchorClick(event, anchor, targetUrl)) {
        return;
      }

      event.preventDefault();
      openGuardedBlankWindow(originalOpen, targetUrl, "_blank");
    },
    true
  );
}

function installWindowOpenPatch(originalOpen) {
  window.open = function openWithFrameworkTabAccess(url = "", target = "_blank", features = undefined) {
    const targetUrl = parseLocalGuardedUrl(url);

    if (hasCurrentTabAccess() && isBlankTarget(target) && targetUrl) {
      return openGuardedBlankWindow(originalOpen, targetUrl, target, features);
    }

    return originalOpen.call(window, url, target, features);
  };
}

export function installFrameworkNewWindowAccess() {
  if (window[INSTALL_KEY]) {
    return;
  }

  const originalOpen = typeof window[ORIGINAL_OPEN_KEY] === "function"
    ? window[ORIGINAL_OPEN_KEY]
    : window.open;

  if (typeof originalOpen !== "function") {
    return;
  }

  window[INSTALL_KEY] = true;
  window[ORIGINAL_OPEN_KEY] = originalOpen;

  installWindowOpenPatch(originalOpen);
  installBlankAnchorHandler(originalOpen);
}
