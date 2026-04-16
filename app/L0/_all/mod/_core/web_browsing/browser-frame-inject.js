(() => {
  const BRIDGE_CHANNEL = "space.web_browsing.browser_frame";
  const BRIDGE_PHASE = Object.freeze({
    EVENT: "event",
    REQUEST: "request",
    RESPONSE: "response"
  });
  const BRIDGE_GLOBAL_KEY = "__spaceBrowserFrameInjectBridge__";
  const BRIDGE_META_KEY = "__spaceBrowserFrameInjectMeta__";
  const BRIDGE_DOM_FLAG = "__spaceBrowserFrameInjectDomReady__";
  const BRIDGE_PING_FLAG = "__spaceBrowserFrameInjectPingReady__";

  function isPlainObject(value) {
    if (!value || Object.prototype.toString.call(value) !== "[object Object]") {
      return false;
    }

    const prototype = Object.getPrototypeOf(value);
    return (
      prototype === Object.prototype
      || prototype === null
      || prototype?.constructor?.name === "Object"
    );
  }

  function createNamedError(name, message, details = {}) {
    const error = new Error(message);
    error.name = name;
    Object.assign(error, details);
    return error;
  }

  function createDeferred() {
    let resolve = null;
    let reject = null;
    const promise = new Promise((nextResolve, nextReject) => {
      resolve = nextResolve;
      reject = nextReject;
    });

    return {
      promise,
      reject,
      resolve
    };
  }

  function createRequestId() {
    if (typeof globalThis.crypto?.randomUUID === "function") {
      return globalThis.crypto.randomUUID();
    }

    return `browser-frame-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function normalizeType(type) {
    const normalizedType = String(type || "").trim();
    if (!normalizedType) {
      throw new Error("Browser frame bridge messages require a non-empty type.");
    }

    return normalizedType;
  }

  function cloneValue(value, seen = new WeakMap()) {
    if (value == null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      return value;
    }

    if (typeof value === "bigint") {
      return Number(value);
    }

    if (typeof value === "function" || typeof value === "symbol") {
      return undefined;
    }

    if (value instanceof Error) {
      return {
        message: value.message,
        name: value.name || "Error",
        stack: value.stack || ""
      };
    }

    if (typeof globalThis.URL === "function" && value instanceof globalThis.URL) {
      return value.href;
    }

    if (value instanceof Date) {
      return new Date(value.getTime()).toISOString();
    }

    if (value instanceof RegExp) {
      return String(value);
    }

    if (typeof globalThis.Window === "function" && value instanceof globalThis.Window) {
      return null;
    }

    if (typeof globalThis.Element === "function" && value instanceof globalThis.Element) {
      return null;
    }

    if (seen.has(value)) {
      return seen.get(value);
    }

    if (Array.isArray(value)) {
      const clonedArray = [];
      seen.set(value, clonedArray);

      value.forEach((entry) => {
        const clonedEntry = cloneValue(entry, seen);
        clonedArray.push(clonedEntry === undefined ? null : clonedEntry);
      });

      return clonedArray;
    }

    if (value instanceof Map) {
      const clonedEntries = [];
      seen.set(value, clonedEntries);

      value.forEach((entryValue, entryKey) => {
        clonedEntries.push([
          cloneValue(entryKey, seen),
          cloneValue(entryValue, seen)
        ]);
      });

      return clonedEntries;
    }

    if (value instanceof Set) {
      const clonedEntries = [];
      seen.set(value, clonedEntries);

      value.forEach((entryValue) => {
        clonedEntries.push(cloneValue(entryValue, seen));
      });

      return clonedEntries;
    }

    if (value instanceof ArrayBuffer) {
      return value.slice(0);
    }

    if (typeof ArrayBuffer !== "undefined" && ArrayBuffer.isView(value)) {
      return Array.from(value);
    }

    if (isPlainObject(value)) {
      const clonedObject = {};
      seen.set(value, clonedObject);

      Object.entries(value).forEach(([key, entryValue]) => {
        const clonedEntry = cloneValue(entryValue, seen);

        if (clonedEntry !== undefined) {
          clonedObject[key] = clonedEntry;
        }
      });

      return clonedObject;
    }

    try {
      return String(value);
    } catch {
      return null;
    }
  }

  function normalizePayload(payload) {
    const normalizedPayload = cloneValue(payload);
    return normalizedPayload === undefined ? null : normalizedPayload;
  }

  function serializeError(error, fallbackMessage = "Browser frame bridge request failed.") {
    const fallback = String(fallbackMessage || "Browser frame bridge request failed.");

    if (error instanceof Error) {
      return {
        code: error.code ?? null,
        details: normalizePayload(error.details || {}),
        message: error.message || fallback,
        name: error.name || "Error",
        stack: error.stack || ""
      };
    }

    if (isPlainObject(error)) {
      return {
        code: error.code ?? null,
        details: normalizePayload(error.details || {}),
        message: typeof error.message === "string" && error.message ? error.message : fallback,
        name: typeof error.name === "string" && error.name ? error.name : "BrowserFrameBridgeError",
        stack: typeof error.stack === "string" ? error.stack : ""
      };
    }

    return {
      code: null,
      details: {},
      message: String(error || fallback),
      name: typeof error || "BrowserFrameBridgeError",
      stack: ""
    };
  }

  function createRemoteBridgeError(message) {
    const payload = isPlainObject(message.payload)
      ? message.payload
      : {
          message: String(message.payload || `Browser frame bridge request \"${message.type}\" failed.`),
          name: "BrowserFrameBridgeError"
        };

    return createNamedError(
      typeof payload.name === "string" && payload.name ? payload.name : "BrowserFrameBridgeError",
      typeof payload.message === "string" && payload.message ? payload.message : `Browser frame bridge request \"${message.type}\" failed.`,
      {
        code: payload.code ?? null,
        details: isPlainObject(payload.details) ? payload.details : {},
        payload,
        requestId: String(message.requestId || ""),
        type: message.type
      }
    );
  }

  function createEnvelope(phase, type, payload, details = {}) {
    const envelope = {
      channel: BRIDGE_CHANNEL,
      payload: normalizePayload(payload),
      phase,
      type: normalizeType(type)
    };

    if (details.requestId) {
      envelope.requestId = String(details.requestId);
    }

    if (phase === BRIDGE_PHASE.RESPONSE) {
      envelope.ok = details.ok !== false;
    }

    return envelope;
  }

  function resolveTargetWindow(targetWindow) {
    if (targetWindow && typeof targetWindow.postMessage === "function") {
      return targetWindow;
    }

    if (typeof globalThis.parent?.postMessage === "function" && globalThis.parent !== globalThis) {
      return globalThis.parent;
    }

    return null;
  }

  function coerceSelectorList(payload) {
    if (Array.isArray(payload?.selectors)) {
      return payload.selectors;
    }

    if (Array.isArray(payload)) {
      return payload;
    }

    return [];
  }

  function normalizeSelectorList(payload) {
    return coerceSelectorList(payload)
      .map((selector) => String(selector || "").trim())
      .filter(Boolean);
  }

  function serializeDocumentHtml() {
    if (typeof globalThis.XMLSerializer === "function" && globalThis.document) {
      try {
        return new globalThis.XMLSerializer().serializeToString(globalThis.document);
      } catch {
        // Fall through to outerHTML-based serialization.
      }
    }

    return String(globalThis.document?.documentElement?.outerHTML || "");
  }

  function serializeSelectorHtml(selector) {
    let elements = [];
    try {
      elements = [...(globalThis.document?.querySelectorAll?.(selector) || [])];
    } catch (error) {
      throw createNamedError(
        "BrowserFrameBridgeSelectorError",
        `Browser frame bridge could not resolve selector \"${selector}\".`,
        {
          details: {
            selector
          }
        }
      );
    }

    return elements
      .map((element) => String(element?.outerHTML || ""))
      .join("\n");
  }

  function collectDomSnapshot(payload = null) {
    const selectors = normalizeSelectorList(payload);
    if (!selectors.length) {
      return {
        document: serializeDocumentHtml()
      };
    }

    const snapshot = {};
    selectors.forEach((selector) => {
      snapshot[selector] = serializeSelectorHtml(selector);
    });
    return snapshot;
  }

  function createBridge(options = {}) {
    const eventListeners = new Map();
    const requestHandlers = new Map();
    const pendingRequests = new Map();
    const targetOrigin = typeof options.targetOrigin === "string" && options.targetOrigin.trim()
      ? options.targetOrigin.trim()
      : "*";
    const defaultTimeoutMs = Math.max(0, Number(options.requestTimeoutMs) || 0);

    function postEnvelope(envelope) {
      const targetWindow = resolveTargetWindow(options.targetWindow);
      if (!targetWindow) {
        throw new Error("Browser frame bridge target window is unavailable.");
      }

      targetWindow.postMessage(envelope, targetOrigin);
      return envelope;
    }

    async function respondToRequest(message) {
      if (!message.requestId) {
        return;
      }

      const handler = requestHandlers.get(message.type);
      if (!handler) {
        postEnvelope(
          createEnvelope(BRIDGE_PHASE.RESPONSE, message.type, serializeError({
            message: `No browser frame bridge handler is registered for \"${message.type}\".`,
            name: "BrowserFrameBridgeMissingHandlerError"
          }), {
            ok: false,
            requestId: message.requestId
          })
        );
        return;
      }

      try {
        const responsePayload = await handler(message.payload, message);
        postEnvelope(createEnvelope(BRIDGE_PHASE.RESPONSE, message.type, responsePayload, {
          ok: true,
          requestId: message.requestId
        }));
      } catch (error) {
        postEnvelope(createEnvelope(BRIDGE_PHASE.RESPONSE, message.type, serializeError(error), {
          ok: false,
          requestId: message.requestId
        }));
      }
    }

    function handleMessage(event) {
      const rawMessage = event?.data;
      if (!rawMessage || rawMessage.channel !== BRIDGE_CHANNEL || typeof rawMessage.type !== "string") {
        return;
      }

      const expectedSource = resolveTargetWindow(options.targetWindow);
      if (expectedSource && event.source !== expectedSource) {
        return;
      }

      const phase = rawMessage.phase;
      if (phase !== BRIDGE_PHASE.EVENT && phase !== BRIDGE_PHASE.REQUEST && phase !== BRIDGE_PHASE.RESPONSE) {
        return;
      }

      const message = {
        ok: rawMessage.ok !== false,
        origin: String(event.origin || ""),
        payload: rawMessage.payload,
        phase,
        raw: rawMessage,
        requestId: typeof rawMessage.requestId === "string" ? rawMessage.requestId : "",
        source: event.source || null,
        type: normalizeType(rawMessage.type)
      };

      if (phase === BRIDGE_PHASE.EVENT) {
        const listeners = eventListeners.get(message.type);
        if (!listeners) {
          return;
        }

        listeners.forEach((listener) => listener(message));
        return;
      }

      if (phase === BRIDGE_PHASE.REQUEST) {
        void respondToRequest(message);
        return;
      }

      const pendingRequest = pendingRequests.get(message.requestId);
      if (!pendingRequest) {
        return;
      }

      pendingRequests.delete(message.requestId);
      if (pendingRequest.timeoutId != null) {
        clearTimeout(pendingRequest.timeoutId);
      }

      if (message.ok === false) {
        pendingRequest.reject(createRemoteBridgeError(message));
        return;
      }

      pendingRequest.resolve(message);
    }

    globalThis.addEventListener("message", handleMessage);

    return {
      channel: BRIDGE_CHANNEL,

      destroy() {
        globalThis.removeEventListener("message", handleMessage);
        pendingRequests.forEach((pendingRequest) => {
          if (pendingRequest.timeoutId != null) {
            clearTimeout(pendingRequest.timeoutId);
          }

          pendingRequest.reject(createNamedError("AbortError", "Browser frame bridge is destroyed."));
        });
        pendingRequests.clear();
        eventListeners.clear();
        requestHandlers.clear();
      },

      handle(type, handler) {
        if (typeof handler !== "function") {
          throw new Error("Browser frame bridge handlers must be functions.");
        }

        const normalizedType = normalizeType(type);
        requestHandlers.set(normalizedType, handler);

        return () => {
          if (requestHandlers.get(normalizedType) === handler) {
            requestHandlers.delete(normalizedType);
          }
        };
      },

      on(type, listener) {
        if (typeof listener !== "function") {
          throw new Error("Browser frame bridge listeners must be functions.");
        }

        const normalizedType = normalizeType(type);
        if (!eventListeners.has(normalizedType)) {
          eventListeners.set(normalizedType, new Set());
        }

        const listeners = eventListeners.get(normalizedType);
        listeners.add(listener);

        return () => {
          listeners.delete(listener);
          if (!listeners.size) {
            eventListeners.delete(normalizedType);
          }
        };
      },

      request(type, payload = null, options = {}) {
        const requestId = createRequestId();
        const deferred = createDeferred();
        const timeoutMs = Math.max(0, Number(options.timeoutMs) || defaultTimeoutMs);
        const normalizedType = normalizeType(type);
        let timeoutId = null;

        if (timeoutMs > 0) {
          timeoutId = setTimeout(() => {
            pendingRequests.delete(requestId);
            deferred.reject(createNamedError(
              "TimeoutError",
              `Browser frame bridge request \"${normalizedType}\" timed out after ${timeoutMs}ms.`,
              { requestId, type: normalizedType }
            ));
          }, timeoutMs);
        }

        pendingRequests.set(requestId, {
          reject: deferred.reject,
          resolve: deferred.resolve,
          timeoutId,
          type: normalizedType
        });

        try {
          postEnvelope(createEnvelope(BRIDGE_PHASE.REQUEST, normalizedType, payload, { requestId }));
        } catch (error) {
          pendingRequests.delete(requestId);
          if (timeoutId != null) {
            clearTimeout(timeoutId);
          }
          deferred.reject(error);
        }

        return deferred.promise;
      },

      send(type, payload = null) {
        return postEnvelope(createEnvelope(BRIDGE_PHASE.EVENT, type, payload));
      }
    };
  }

  function installPingHandler(bridge) {
    if (!bridge || bridge[BRIDGE_PING_FLAG]) {
      return bridge;
    }

    bridge.handle("ping", (payload) => `received:${String(payload ?? "")}`);
    bridge[BRIDGE_PING_FLAG] = true;
    return bridge;
  }

  function installDomHandler(bridge) {
    if (!bridge || bridge[BRIDGE_DOM_FLAG]) {
      return bridge;
    }

    bridge.handle("dom", (payload) => collectDomSnapshot(payload));
    bridge[BRIDGE_DOM_FLAG] = true;
    return bridge;
  }

  const existingBridge = globalThis[BRIDGE_GLOBAL_KEY];
  const bridge = installDomHandler(installPingHandler(existingBridge || createBridge()));
  const bootstrap = isPlainObject(globalThis.__spaceBrowserFrameInjectBootstrap__)
    ? globalThis.__spaceBrowserFrameInjectBootstrap__
    : {};

  globalThis[BRIDGE_GLOBAL_KEY] = bridge;
  globalThis[BRIDGE_META_KEY] = {
    iframeId: typeof bootstrap.iframeId === "string" ? bootstrap.iframeId : "",
    loadedAt: Date.now(),
    scriptPath: typeof bootstrap.scriptPath === "string" ? bootstrap.scriptPath : "",
    scriptUrl: typeof bootstrap.scriptUrl === "string" ? bootstrap.scriptUrl : ""
  };
})();
