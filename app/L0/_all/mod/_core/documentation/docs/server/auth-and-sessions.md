# Auth And Sessions

This doc covers the file-backed auth model and the session contract.

## Primary Sources

- `server/lib/auth/AGENTS.md`
- `server/router/AGENTS.md`
- `server/lib/auth/service.js`
- `server/lib/auth/user_files.js`
- `server/lib/auth/user_manage.js`

## User Storage Layout

Current logical storage:

- `L2/<username>/user.yaml`: user metadata
- `L2/<username>/meta/password.json`: sealed password verifier envelope
- `L2/<username>/meta/logins.json`: active session verifiers plus signed metadata
- `L2/<username>/mod/`: user-owned modules

On disk:

- defaults under repo `app/L2/...`
- relocates under `CUSTOMWARE_PATH/L2/...` when configured
- when `CUSTOMWARE_GIT_HISTORY` is enabled, the L2 history repo ignores `meta/password.json` and `meta/logins.json`, and rollback preserves those current files instead of restoring old auth state

Backend-only auth keys are not stored in the logical app tree.

They come from:

- `SPACE_AUTH_PASSWORD_SEAL_KEY`
- `SPACE_AUTH_SESSION_HMAC_KEY`

or the local fallback `server/data/auth_keys.json`.

## Session Contract

Current session rules:

- cookie name: `space_session`
- `HttpOnly`
- `SameSite=Strict`
- path `/`
- max age: 30 days

Important behavior:

- the browser cookie is a bearer token
- the backend stores only a verifier plus signed metadata in `meta/logins.json`
- unsigned or expired session records are rejected
- revocation deletes the stored session record and refreshes the watchdog

## Password Contract

`password.json` stores a sealed SCRAM verifier envelope.

Important rules:

- do not hand-author these files
- only backend helpers that hold the seal key can create accepted payloads
- legacy plaintext verifier files are migrated to sealed form during startup

## Single-User Runtime

When `SINGLE_USER_APP=true`:

- every request resolves to the implicit `user` principal
- cookie-backed login is bypassed
- permission helpers treat that principal as a virtual `_admin` member

This mode is used especially by packaged desktop flows.

## User Management Helpers

`user_manage.js` currently owns:

- `createUser(...)`
- `setUserPassword(...)`
- `createGuestUser(...)`

Important side effects:

- user creation initializes the user directory, `meta/`, and `mod/`
- password resets rewrite the sealed verifier and clear active sessions
- guest users use randomized `guest_...` usernames
