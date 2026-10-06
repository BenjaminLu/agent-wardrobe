# Desktop agent Mod platform

Current direction: one-click character embodiment for existing Claude Code and Codex installations. Annie is the default bundled Mod, rather than the entire product.

The user confirmed this direction on 2026-10-02 and requested PoC planning. The actionable two-week scope and acceptance criteria are in [POC-PLAN.md](POC-PLAN.md). The existing chat-only prototype is incomplete and is not the planned marketplace deliverable.

## Independent choices

- Engine: Codex, Claude, or local model. Switching engines should retain the selected Mod.

Provider scope confirmed by the user: Claude hooks, Codex App Server, and retained LM Studio support. See [INTEGRATION-NOTES.md](INTEGRATION-NOTES.md) for reference evidence and capability differences.
- Mod: identity, default skin, available personalities, and voice preferences.
- Persona: behavior instructions. Switching personality should retain the skin.
- Skin: visual assets and supported animation states. Switching skin should retain personality.

The first prototype is a chat companion using a CLI. It does not yet observe or visualize an existing coding session. An eventual coding-session companion needs an explicit connection to supported session events, with user-controlled access.

## Two-week proof of concept

Deliver engine selection, bundled Mod selection, persona selection, desktop overlay, voice, and a local Skin library. Validate whether users keep the companion running and whether different skins make them want to customize it.

The marketplace first needs a browse/preview/install flow with clearly labeled demonstration listings. Paid purchases, creator payouts, hosted uploads, and licensing enforcement are a later implementation; no mock purchase should claim real payment success.

## Package boundary

Use versioned JSON manifests with declarative visual assets and text personality instructions. Imported packages must not execute JavaScript, shell commands, arbitrary HTML, or request new agent permissions. Validate paths and sizes before installation. A skin purchase grants access to that skin, not a different level of AI capabilities or plan quota.

The bundled Mods in `mods/` record the package format. Bundled characters must be original or openly licensed (`scripts/check-mods.cjs` enforces it). Third-party characters reach users only through the store, under their own licences.
