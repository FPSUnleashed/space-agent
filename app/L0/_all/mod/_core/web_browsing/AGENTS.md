# AGENTS

## Purpose

`_core/web_browsing/` owns the first pass of the browser overlay module.

It contributes a Browser action to the routed onscreen menu and mounts a draggable, minimizable, resizable floating iframe window through the router overlay seam. The current pass stays fully self-contained inside this module: it ships the floating shell, the placeholder iframe page, the host/frame message bridge pair, and the stable iframe `data-space-inject` path that packaged desktop runs can now activate through the Electron frame-preload hook while normal browser sessions still leave it dormant.

Documentation is top priority for this module. After any change under `_core/web_browsing/`, update this file, affected parent docs, and the matching supplemental docs under `_core/documentation/docs/` in the same session.

## Ownership

This module owns:

- `menu-item.html`: real Browser dropdown action component for the routed onscreen menu
- `window.html`: floating browser-window component mounted into the router overlay layer
- `store.js`: shared Alpine store for open state, geometry, focus, drag, resize, minimize, and viewport clamping
- `window.css`: local floating-window styling, title bar, iframe shell, and resize handle
- `browser-frame.html`: module-owned iframe placeholder page
- `browser-frame-protocol.js`: shared host/frame `postMessage` protocol, payload normalization, and request-response bridge factory
- `browser-frame-bridge.js`: outside-side helper that Space Agent surfaces can use to talk to the iframe window
- `browser-frame-inject.js`: inside-side bridge runtime fetched and evaluated by the packaged desktop frame-preload hook when an iframe opts in through `data-space-inject`
- `ext/html/_core/onscreen_menu/items/browser.html`: thin routed menu-item adapter
- `ext/html/page/router/overlay/end/browser-window.html`: thin routed overlay adapter

## Local Contracts

- this module must mount only through `_core/onscreen_menu/items` and `page/router/overlay/end`; do not hardcode it into `_core/onscreen_menu/` or `_core/router/`
- the routed menu action is owned here through `_core/onscreen_menu/items` with `data-order="250"`
- the menu action must open the floating window, restore it from minimized state, and focus it without changing the current route
- the floating window is viewport-fixed, draggable from its compact title bar, minimizable and closable from its header controls, resizable from its bottom-right handle, and clamped only to the live viewport edges without reserving extra drag space below the routed top bar
- resizing should allow the window to grow to the full available viewport area instead of stopping at a smaller fixed max width or height
- minimizing the window should collapse it to a fixed `12em` width while keeping the compact header visible for restore and drag
- window state is browser-local only in this pass; the module must not create backend state or persist geometry yet
- the iframe must load `/mod/_core/web_browsing/browser-frame.html`, keep the stable id `browser-1`, and carry `data-space-inject="/mod/_core/web_browsing/browser-frame-inject.js"` on the iframe element itself
- the outside helper at `/mod/_core/web_browsing/browser-frame-bridge.js` must expose a console-friendly `send(iframeId, type, payload)` request helper that addresses iframes by DOM id and resolves with the response payload
- every bridge envelope must be prefixed by the module-local `space.web_browsing.browser_frame` channel and must include `type` plus JSON-safe `payload`; request and response envelopes must also carry `requestId`, and responses should reuse the originating request `type`
- packaged desktop runs may use the Electron frame-preload hook in two phases: a subframe-only document-start main-world `attachShadow(...)` override that forces future shadow roots open inside iframe documents, and the later `data-space-inject` runtime path; the runtime path must accept only same-origin script URLs whose normalized path starts with `/mod/` and must reject remote origins, query or hash decorations, and path-trick variants
- the injected-side runtime must register a `ping` request handler that responds with the exact string `received:<payload>` for smoke testing from the host helper
- the injected-side runtime must also register a `dom` request handler; when called with no selectors it must return `{ document: "<serialized html>" }`, and when called with `{ selectors: [...] }` it must return an object whose keys are the original selector strings and whose values are the concatenated matched `outerHTML` strings for each selector
- normal browser sessions must still leave the file named by `data-space-inject` inactive until a non-desktop browser-side injector exists
- the placeholder frame should keep a dark background, centered red engineer full-body artwork from `/mod/_core/visual/res/engineer/astronaut_red_no_bg.png`, and the same slow floating motion language used by the first-party chat and launcher astronaut treatments, with the exact text `browser feature is currently being implemented`

## Development Guidance

- keep browser-overlay behavior self-contained here unless a stable menu or router seam changes
- prefer extending this module's store and component pair over adding ad hoc globals or shell patches
- keep the iframe shell generic enough that later browsing logic can replace only the inner frame content and injection handling without rewriting the floating-window chrome
- if the overlay seam, menu-item order, iframe source path, iframe id, `data-space-inject` contract, packaged-desktop injection rules, or browser-frame bridge envelope shape changes, update this file, `/app/AGENTS.md`, `/packaging/AGENTS.md`, and the matching docs under `_core/documentation/docs/`
