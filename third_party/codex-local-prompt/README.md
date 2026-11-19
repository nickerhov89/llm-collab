# Codex local-model prompt

The runtime constant in `packages/server/src/sdk/providers/codex-gateway-prompt.ts`
is the unchanged local-model prompt from openai/codex, tag rust-v0.167.0:
https://github.com/openai/codex/blob/rust-v0.167.0/codex-rs/models-manager/prompt.md

Copyright OpenAI. Licensed under Apache-2.0; see LICENSE in this directory.
SHA-256 of the original prompt bytes: `ac8ae107a0d72fe3476b430afb161ea4e67da2e446d778aefc44828160559807`.

Only the explicit Polza Codex gateway launch uses it. The installed CLI
uses this same prompt for unknown/local models; supplying the catalog retains
those instructions while declaring actual gateway model metadata.
