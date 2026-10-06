# Skin switching regression verification

2026-10-02. User reported that Mod / Skin clicks still appeared unresponsive.

The original browser page was tied to a randomly allocated port and a newly generated token on every launch. App updates/restarts invalidated that page. Merely fixing card DOM replacement did not fix this lifecycle problem. The transparent always-on-top window also covered a browser hit area unless it was put into click-through mode; opening or reconnecting the wardrobe now enables that mode.

Changes: persisted local control port/authorization; a fresh runtime instance id so revisions can reset after restart; visible disconnection feedback; native desktop click-through during browser control. The enlarged AI settings button is included in this build.

Verification used both native Electron mouse-down/up input and Chrome DevTools clicks on the packaged app's actual browser page, not only DOM `.click()` calls. All six skin buttons were exercised and app selection checked individually. The packaged app was quit and relaunched while leaving the original Chrome tab open; the URL and authorization remained valid and that tab reported connected again. Native smoke also verifies that a post-restart Skin reaches the desktop SVG and checks the actual rendered color.

`npm test`: 16 tests pass. Native smoke: native mouse, stable targets during speaking updates, rapid card clicks, stale response rejection, old page reconnection after restart, desktop skin/color sync, and restoration from click-through pass.

Desktop diagnostic endpoint `/api/desktop` is token-protected and returns only rendered character name, skin body color, settings button size and click-through state. It cannot execute caller-supplied JavaScript or read conversations.

The final packaged browser check clicked all six skins and independently read the desktop renderer name/color after each click; all matched. Opening a wardrobe from the app or reconnecting an existing page automatically enables click-through. The browser remembers its local control authorization across tabs so a bookmarked stable URL works after the first app-authorized visit. Port conflicts produce an explicit startup dialog rather than silently changing the URL.

## Native wardrobe follow-up

Skin switching now lives directly in the desktop companion panel behind **◈ Skin**. Tray/menu actions and `--open-wardrobe` open this panel rather than an external browser. The renderer reads bundled manifests and selects through Electron IPC. Browser SSE connections no longer implicitly enable desktop click-through.

Native mouse-down/up testing exercised all six embedded skin buttons and independently checked the desktop SVG body color after each selection. The completion button restores the chat panel. The optional web smoke explicitly enables streaming for its browser tests.

## App marketplace and idle chat

The global ⌘⇧S shortcut, companion Skin button and menu now open one dedicated sandboxed Electron marketplace window using local packaged files and restricted IPC. Search covers Mod/skin/personality names and localized character aliases, with a clear empty state. Native smoke types mixed-case skin names, Chinese aliases and non-matching queries; clicks all six skins; verifies desktop colors; verifies window reuse, ⌘F focus, Esc close and restoring the companion.

The companion chat now fades after 15 seconds without interaction and its native window shrinks from 620 to 340 px to reduce the invisible hit area. Drafts, active replies and open settings prevent auto-collapse. A Chat button and ⌘⇧B restore the panel. Native smoke waits the actual idle interval, verifies native height changes and restoration, and checks draft/settings preservation.

## Avatar operation results across providers

39 Node tests pass: official PTY/Auto permissions, literal task arguments, opted-in result hooks, session isolation, duplicate and post-cancel rejection, API failure distinction, local model tool observations and fetch aborts, Codex dynamic-tool flow, tool argument / protocol / mode validation, plus existing skin/control regressions.

`npm start -- --smoke-test --task-smoke` passed:

- A local HTTP model fixture invokes actual Chromium tools, clicks Increase on a local test page, observes Count: 1, then explains that result through Avatar. A held subsequent model request is cancelled by emergency stop. This verifies the LM Studio-compatible loop, not a real loaded LM Studio model.
- Real Codex app-server dynamically opens the same local test page, clicks Increase and verifies Count: 1. Its real final Chinese reply is shown by the character, with no CLI window.
- Real Claude Code sends its final Chinese response via the official Stop hook into Avatar, without an automatic CLI window. Avatar speech starts. This harmless task does not execute screen or Chrome tools.
- Official confirmation UI can still be opened separately. Screenshot: `evidence/avatar-task-result.png`.

The macOS Swift native input helper compiles and is locally signed. Native external-app clicking/typing remains untested until the user grants Accessibility and Screen Recording. Claude computer-use / Chrome tool connectivity also needs official first-run setup. These are separate from successful provider-to-avatar result routing.

Emergency stop retains the red Avatar/console buttons and global ⌘⇧X. A stubborn owned CLI is stopped without touching unrelated processes. Local request cancellation prevents additional tool execution and suppresses late replies. Full marketplace/idle regression is covered by `npm start -- --smoke-test`.

The default LM Studio endpoint `http://127.0.0.1:1234/v1/models` was checked after implementation and was unavailable. A loaded local model remains a user setup dependency. Operation explanations are retained in the selected provider's conversation; chat does not auto-collapse while Avatar speech is active.

Auto task defaults revalidated against installed Claude CLI and a live Codex app-server. Native task smoke passed Chromium click/read/result, local request abort, Codex result and Claude hook result with no automatic CLI popup. New regression covers scoped Codex turn/steer and local interruptions skipping stale planned actions. Claude queued input is integrated through bracketed paste into the owned PTY; real browser permission recovery and mid-operation Claude input have not been end-to-end verified. Shopping site actions and real LM Studio models were not exercised.

Human conversation relay: 39 Node tests pass, including display batch assembly, out-of-order delivery, replay/cancellation isolation, opt-in privacy and tool-line filtering. Native task smoke passed: the supplied refrigerator progress sentence appears in Avatar during the local tool loop; raw browser tool names and Running labels do not. The installed Claude CLI emits MessageDisplay text through owned hooks into Avatar before its Stop outcome, with one final bubble instead of duplicate prose. Codex live task, actual Chromium actions, local request abort and Claude speech also pass. Local model testing uses an HTTP fixture, not a loaded LM Studio model.

Persistent memory/input verification: 39 Node tests pass, including disk roundtrip, old fridge dimensions retrieval, shared provider memory, progress replacement, exact-workspace text-only migration, clearing without resurrection and corrupt-file preservation. Two separate Electron processes passed write/restart/read testing, including restored avatar UI and actual HTTP model payload containing previous fridge constraints. Native copy of an arbitrary substring, Edit menu, trusted clipboard paste auto-send, multiline input, composition guard, voice-off draft retention, provider switching and clear all passed. Typeless is installed; its actual microphone/transcription service was not exercised.

Desktop deliverables: 39 Node tests pass. Coverage includes output confinement, symbolic-link rejection, JSON validation, duplicate filenames without overwriting, cancellation write lockout, persisted artifact references, document request routing and real stdio MCP saving. Native output smoke passed: local HTTP model creates Markdown plus CSV from a normal chat request; actual Codex app-server and official Claude CLI each call the save tool and produce verified files; Avatar attaches a folder button and Finder opens it. A separate Electron restart restores the artifact button and reopens the prior saved folder. Smoke outputs use an isolated mock Desktop under .smoke-userdata, not the user's actual Desktop. Real LM Studio loaded models and arbitrary custom output directories are not validated.

Native file catalog: 39 Node tests pass. Catalog tests cover task/filename search, unrecorded/path-traversal rejection and omission of deleted files. Native fixture smoke passed real avatar-toolbar mouse click, toolbar fit, native files window, search/empty results, default-app file opening, Finder folder/reveal, rejected traversal, window reuse, global Cmd+Shift+O registration and Escape close. Fixture outputs remain under .smoke-userdata.

## Native computer tools on a real external app

2026-10-02. First run with real macOS Accessibility and Screen Recording grants. `open -n "dist/Agent Wardrobe.app" --args --smoke-test --computer-smoke` drives TextEdit only through the model-facing `computer_*` tools: observe (real screen capture), click inside the TextEdit window, ⌘A, type a mixed English/Chinese marker, ⌘A ⌘C, then compare the clipboard. Passed on the packaged app. The smoke refuses to send input unless TextEdit is frontmost, so it must run with the Mac idle; progress is written to `$TMPDIR/agent-wardrobe-smoke/computer-smoke.log` because LaunchServices launches drop stdout. Launching from a terminal attributes privacy checks to the terminal and is not a valid test.

The live run exposed two helper defects that unit tests could not: typing silently dropped any text over 20 UTF-16 units (one `CGEventKeyboardSetUnicodeString` call per string), and typing right after a ⌘ shortcut re-sent ⌘A because the unicode event reused virtual key 0 with inherited modifier flags. Text is now sent in whole-character chunks of at most 20 units with flags cleared. Before this fix, Codex / LM Studio `computer_type` reported success while typing nothing for longer text.

Packaging now signs with a local self-signed identity (`npm run sign:setup` once per Mac), so the designated requirement is the bundle identifier plus certificate rather than a per-build cdhash, and privacy grants survive rebuilds; verified by re-signing after granting. Without the certificate, packaging falls back to ad-hoc and warns. A packaged `--smoke-test` previously wrote `.smoke-userdata` inside the bundle (`app.isPackaged` is false because the executable keeps Electron's name), invalidating the seal so LaunchServices refused to launch it; smoke data for a packaged run now goes to the temp directory.

Claude path, same day: computer-use was enabled for the App's own Claude workspace through **Official Claude setup** → `/mcp` (it is separate from any other Claude Code session's setting). A task sent from the companion in Computer use mode ("open TextEdit, new blank document, type Claude 實測 2012, do not save") ran through official computer-use; Avatar showed the official progress line and the final result, persisted in `conversation-history.json`. Computer-use allows one Claude session at a time (`~/.claude/computer-use.lock`); while another session held it, the task correctly ended with an honest not-done explanation in Avatar. Launching the App from inside Claude Code previously leaked `CLAUDE_CODE_*` markers into its Claude session (transcripts disabled); spawned Claude processes now drop them.

Claude Chrome path, same day: a Browser use task from the companion ("open https://example.com in Chrome, report the title and first paragraph, read only") ran through the official Claude in Chrome extension and returned in 33 s; the title and paragraph shown in Avatar match a direct fetch of the page.

Not yet exercised: Codex / LM Studio models choosing coordinates from the screenshot, Claude Chrome tasks that click or type, multiple displays.

## Auto task routing and stop control

2026-10-02. Auto is the default mode: the shared companion prompt lets every provider return `"action":"browser|computer|files"`, and only those three values start a task (unit tests reject others). Chat-only mode never starts one. The stop control is hidden until a task is active. `npm start -- --smoke-test --auto-smoke` (HTTP model fixture) passed: a factual question stays in chat with no stop control; a web request shows the model's acknowledgement, starts a real Chromium task, shows the stop control, then hides it after the result. On the packaged app with Claude, a request already answered earlier stayed in chat and cited the earlier result; a new IANA page request was routed to Claude in Chrome and answered in 18 s, with the stop control appearing and disappearing. `--files-smoke` times out with the accumulated `.smoke-userdata` both before and after this change and passes with a fresh one; smoke runs share state.

## Mod renderers: SVG parts, PNG layers, VRM

2026-10-03. Mods can ship their own artwork (`schemaVersion: 2`, see MODS.md). The main process validates every Mod before any page sees it: SVG parts are reduced to an allowlist of shape elements, attributes, classes and palette variables; images must be real PNG/WebP files inside the Mod folder (no symlinks, size-limited); VRM files must be self-contained glTF with VRM metadata that allows redistribution. Pages receive VRM bytes over IPC (Electron) or a catalog-checked HTTP route (web wardrobe). Page CSP gains only `blob:` for img/connect, needed for embedded VRM textures; network fetches stay blocked. three.js 0.186 and three-vrm 3.5.5 are bundled locally into `vendor/vrm-kit.js` (`npm run build:vrm`).

Annie moved from code into `mods/annie/parts.json` and renders identically. Samples: `pixel-byte` (PNG layers rasterized from Byte) and `vrm-sample` (at the time pixiv's VRM 1.0 sample avatar; since replaced by Blocky, an original CC0 model built by `scripts/make-sample-vrm.cjs`). 54 Node tests pass, including sanitizer rejection of scripts, links, handlers, styles, foreign URLs and unknown classes, asset traversal and symlink rejection, VRM external-URI and licence checks, and the asset HTTP route. `--mods-smoke` mounts each renderer in the real window: SVG draws, every PNG layer decodes, the VRM canvas is >5% covered with textures and no load error, and blink/look/react/talk run on each. Main, auto, files and memory/input smokes pass with 6 characters and 13 skins. The packaged, signed app shows the VRM Mod over the desktop.

Not yet done: contribution CI (automated preview renders on pull requests), user-installed Mods outside the app bundle, and (since fixed) a Mod that failed validation used to stop the app from starting; it is now skipped and reported.
