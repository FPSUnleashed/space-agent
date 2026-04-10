# AGENTS

## Purpose

`_core/onscreen_menu/` owns the routed top-right page menu and Home shortcut.

It is a thin shell extension that mounts into the router shell, keeps a menu-owned Home button beside the hamburger, exposes the `_core/onscreen_menu/items` HTML extension seam for feature-owned menu actions, and keeps only the auth exit action local after that seam.

Documentation is top priority for this module. After any change under `_core/onscreen_menu/`, update this file and any affected parent docs in the same session.

## Ownership

This module owns:

- `ext/html/_core/router/shell_start/menu.html`: thin shell-start extension that declares the Home button, item seam, and local auth exit action
- `onscreen-menu.css`: menu-specific styling layered on the shared topbar primitives

Feature-owned menu item extensions do not belong in this module. Current first-party item adapters live in `_core/agent`, `_core/time_travel`, `_core/file_explorer`, and `_core/admin`.

## Current Contract

Current behavior:

- the menu mounts through `_core/router/shell_start`
- the Home button is always visible to the left of the hamburger button
- the Home button routes to the empty router path `#/` so the router's default-route contract, currently Dashboard, decides the actual home screen
- `_core/onscreen_menu/items` is rendered inside the menu panel before the local auth exit action
- item adapters should be thin HTML extension files that render shared `space-topbar-menu-action` buttons
- item buttons should set numeric `data-order` values, usually spaced by hundreds, because the menu shell sorts contributed extension wrappers by the first descendant `data-order` or `order` value it finds
- route item adapters call the menu-provided `openRoute(routeHash)` helper with their owning route
- `openRoute(routeHash)` keeps iframe-local routed navigation inside the `/admin` split-view iframe and otherwise prefers `window.top` with a current-window fallback
- the Agent item is contributed by `_core/agent` with `data-order="100"`
- the Files item is contributed by `_core/file_explorer` with `data-order="200"`
- the Time Travel item is contributed by `_core/time_travel` with `data-order="300"`
- the Admin item is contributed by `_core/admin` with `data-order="400"` and owns the `/admin?url=<current-path-search-hash>` handoff
- the local auth exit action is rendered after `_core/onscreen_menu/items`
- when frontend config reports `SINGLE_USER_APP=true`, the local auth exit action is labeled Leave, clears the current tab's launcher-access grant, and navigates to `/enter`
- otherwise, the local auth exit action is labeled Logout and navigates to `/logout`

## Development Guidance

- keep this module thin; it should stay a routed shell affordance, not a second app shell
- prefer shared topbar and menu styles from `_core/visual/chrome/topbar.css`
- keep Home pointed at the empty route instead of hardcoding `#/dashboard`, so the router can change its default home without menu changes
- add feature menu entries from the owning feature module through `_core/onscreen_menu/items` instead of hardcoding them in `menu.html`
- pick `data-order` values with gaps so downstream modules can insert actions between first-party items without replacing them
- if the item seam, router shell seam, route helper behavior, or auth exit behavior changes, update this file and any owning feature docs that rely on that contract
