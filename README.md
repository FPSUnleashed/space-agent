# Agent One

Browser-first AI agent runtime with a thin local Node.js server.

The browser app is the primary runtime. The server exists to keep a narrow boundary around:

- outbound fetch proxying for requests that would otherwise hit CORS limits
- SQLite ownership and integrity-safe persistence operations

## Status

This repo is currently organized around a layered browser runtime:

- `app/L0/`: active browser firmware layer
- `app/L1/`: reserved system layer
- `app/L2/`: reserved user layer

`app/L1/` and `app/L2/` are gitignored so local system and user data are not touched by source updates.

## Requirements

- Node.js 20 or newer
- Git on `PATH` if you want to use the source updater

## Source Install

Install the runtime dependencies and start the local browser-first app:

```bash
npm install
npm run dev
```

`npm run dev` uses a small supervisor under `server/` to watch `A1.js`, `commands/`, and `server/`, then restarts the local server when server-side code changes.
Browser files under `app/` still need a manual browser refresh because live reload is not wired in yet.

Or run the server directly:

```bash
node A1.js serve
```

The web server binds to `0.0.0.0` by default so container hosts like Render can detect the open port.
The CLI prints a browser-friendly local URL such as `http://127.0.0.1:3000`.
For a local-only bind, pass `--host 127.0.0.1`.

## Optional Packaging Toolchain

Desktop and packaging features are installed separately so a normal source install stays lean.

Install packaging-only dependencies when you need Electron or native build output:

```bash
npm run install:packaging
```

After that, the desktop host and packaging commands are available.

## Desktop Commands

Run the current Electron desktop host:

```bash
npm run desktop:dev
```

Build an unpacked desktop app for the current host platform:

```bash
npm run desktop:pack
```

Build packaged output for the current host platform:

```bash
npm run desktop:dist
```

Build a specific desktop target:

```bash
npm run package:desktop:macos
npm run package:desktop:linux
npm run package:desktop:windows
```

Packaging output is written under:

```text
dist/desktop/<platform>
```

Examples:

- `dist/desktop/macos`
- `dist/desktop/linux`
- `dist/desktop/windows`

## Updating A Source Checkout

The updater is for source checkouts only. It requires Git and a real git worktree.

Update the current branch:

```bash
node A1.js update
```

Update to a specific branch:

```bash
node A1.js update --branch main
node A1.js update main
```

Move the current or remembered branch to a specific tag:

```bash
node A1.js update v0.3
```

Move to a specific commit:

```bash
node A1.js update 1a2b3c4
node A1.js update 1a2b3c4d5e6f...
```

Update behavior:

- plain `update` fast-forwards the current branch from `origin`
- if you previously moved to a tag or commit, plain `update` reconnects to the remembered branch or the remote default branch
- tag and commit updates stay on a branch when a current or remembered branch can be recovered
- detached HEAD is only used as a fallback when no branch can be recovered
- tracked local changes block the update so internal files are not silently overwritten

If Git is missing, the updater prints a platform-specific install hint instead of failing with a raw spawn error.

## CLI Surface

The supported CLI commands are:

```bash
node A1.js serve
node A1.js update
node A1.js help
node A1.js --help
node A1.js version
node A1.js --version
```

## Top-Level Layout

```text
A1.js         Root CLI router
commands/     CLI command modules
server/       Thin local server
app/          Layered browser runtime
packaging/    Native hosts, packaging scripts, and platform metadata
```

## Design Direction

- browser first, server last
- keep agent logic in the browser whenever possible
- keep the server narrow and explicit
- keep native hosts thin
- treat packaging as optional infrastructure around the browser runtime, not the main runtime
