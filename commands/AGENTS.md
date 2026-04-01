# AGENTS

## Purpose

`commands/` contains CLI command modules used by `A1.js`.

## Contract

Each command module should export:

- `execute(context)`
- `help`

## Current Commands

- `group`
- `serve`
- `help`
- `user`
- `version`
- `update`

## Guidance

- keep command modules small and explicit
- put shared CLI routing behavior in `A1.js`
- keep `help` metadata accurate because it is collected dynamically
- prefer commands that edit runtime state through explicit filesystem contracts such as `user.yaml`, `logins.json`, and `group.yaml`
- prefer a small number of readable top-level commands with subcommands over proliferating one-file one-action command names
