# AGENTS

## Purpose

`_core/agent_prompt/` owns the shared prepared-prompt runtime used by first-party agent surfaces.

It is a headless helper module. It does not own any prompt text, skill policy, transport code, or UI. It only owns prompt-instance lifecycle and the generic build or rebuild flow that surface modules plug into with their own prompt builders.

Documentation is top priority for this module. After any change under `_core/agent_prompt/`, update this file and any affected parent or consumer docs in the same session.

## Ownership

This module owns:

- `prompt-runtime.js`: shared `AgentPromptInstance` lifecycle, prompt-input cloning, prompt-history rebuild fallback, and the stable `createAgentPromptInstance(...)` / `hasPreparedPromptInput(...)` helpers used by agent surfaces

## Local Contracts

Current shared runtime contract:

- this module is prompt-builder-agnostic; callers must provide `buildPromptInput(context)` and may optionally provide `updatePromptHistory({ context, historyMessages, options, prompt, promptInput })`
- `build(...)` stores normalized prompt context, calls the supplied builder, and returns a cloned prompt-input snapshot
- `updateHistory(...)` reuses the caller-supplied history updater when one exists and a prompt input was already built; otherwise it falls back to a full `build(...)`
- `getPromptInput()` returns a cloned snapshot so callers cannot mutate the runtime-owned cached prompt input directly
- prompt inputs are treated as plain structured data; builders must not leave live runtime objects, functions, DOM nodes, or other non-cloneable values inside the cached prompt input
- the runtime clones prompt context and prompt-input snapshots defensively; when `structuredClone(...)` rejects a non-cloneable value, the fallback clone keeps plain JSON-like data and drops runtime-only values instead of crashing prompt-history or retry flows
- this module must not depend on surface-specific prompt-entry shapes beyond cloning and caching them

## Development Guidance

- keep surface-specific prompt seams, skill discovery, examples, and transient-section policy in the owning agent modules
- keep this module headless and reusable; do not add UI, transport, or skill-loading behavior here
- if the shared prompt-instance lifecycle changes, update both consumer docs and the supplemental agent-runtime docs
