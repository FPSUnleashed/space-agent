const { ipcRenderer } = require("electron");

const FRAME_INJECT_REGISTER_CHANNEL = "space-desktop:frame-inject-register";
const INJECT_ATTRIBUTE = "data-space-inject";
const FRAME_SELECTOR = `iframe[${INJECT_ATTRIBUTE}]`;
let nextGeneratedFrameName = 1;
let syncScheduled = false;
let documentObserver = null;

function normalizeText(value) {
  return String(value || "").trim();
}

function isIframeElement(value) {
  return Boolean(value && String(value.tagName || value.nodeName || "").toUpperCase() === "IFRAME");
}

function ensureFrameName(iframe) {
  const existingName = normalizeText(iframe.name);
  if (existingName) {
    return existingName;
  }

  const existingId = normalizeText(iframe.id);
  const nextName = existingId || `space-inject-frame-${nextGeneratedFrameName++}`;
  iframe.name = nextName;
  return nextName;
}

function collectFrameEntries(root = globalThis.document) {
  if (!root?.querySelectorAll) {
    return [];
  }

  return [...root.querySelectorAll(FRAME_SELECTOR)]
    .filter((iframe) => isIframeElement(iframe))
    .map((iframe) => {
      const injectPath = normalizeText(iframe.getAttribute(INJECT_ATTRIBUTE));
      if (!injectPath) {
        return null;
      }

      const frameName = ensureFrameName(iframe);
      return {
        frameName,
        iframeId: normalizeText(iframe.id) || frameName,
        injectPath
      };
    })
    .filter(Boolean);
}

function syncFrameRegistry() {
  syncScheduled = false;
  ipcRenderer.send(FRAME_INJECT_REGISTER_CHANNEL, {
    frames: collectFrameEntries()
  });
}

function scheduleFrameRegistrySync() {
  if (syncScheduled) {
    return;
  }

  syncScheduled = true;
  queueMicrotask(syncFrameRegistry);
}

function installDocumentObserver() {
  if (documentObserver || !globalThis.document?.documentElement) {
    return;
  }

  documentObserver = new MutationObserver(() => {
    scheduleFrameRegistrySync();
  });

  documentObserver.observe(globalThis.document.documentElement, {
    attributeFilter: [INJECT_ATTRIBUTE, "id", "name"],
    attributes: true,
    childList: true,
    subtree: true
  });
}

function installFrameRegistrySync() {
  if (!process.isMainFrame) {
    return;
  }

  installDocumentObserver();
  scheduleFrameRegistrySync();

  if (globalThis.document?.readyState === "loading") {
    globalThis.addEventListener("DOMContentLoaded", () => {
      installDocumentObserver();
      scheduleFrameRegistrySync();
    }, { once: true });
  }

  globalThis.addEventListener("beforeunload", () => {
    ipcRenderer.send(FRAME_INJECT_REGISTER_CHANNEL, {
      frames: []
    });
  }, { once: true });
}

installFrameRegistrySync();
