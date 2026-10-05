# Feature notes

Detailed behaviour notes collected during the PoC. Start with the [README](../README.md).

## App Mod Marketplace

**⌘⇧S** opens the standalone desktop **Mod Marketplace** window from any app while Agent Wardrobe is running. The companion's **◈ Skin** button and tray/application menu open the same window. Search names, descriptions, skin names and personalities, including `Bulu`, `鯨魚`, `貓`, and `機器人`. **⌘F** focuses search; **Esc** closes the marketplace. Apply a Mod or click its skin to update the desktop immediately. Repeated shortcuts reuse the same window.

The searchable collection currently includes the 3 bundled Mods / 6 skins; remote listings, publishing, purchases and downloads are not implemented. The marketplace loads packaged local files and uses restricted IPC; no browser or web control login is needed. Closing it restores companion controls unless it was already in stream mode.

## Companion idle behavior

After 15 seconds without interaction, the chat panel fades away and the native window shrinks to the character and small toolbar. Draft text, a running reply and open AI settings keep the panel visible. Click **Chat** or press **⌘⇧B** to restore it; **⌘⇧S** still opens the Mod Marketplace.

# Agent Wardrobe — first character PoC

Electron desktop companion with a native searchable Mod Marketplace and an optional local web control endpoint. Every character is a Mod, and Annie is the default. Bundled: Annie (SVG parts), Miso and Byte (code-drawn cat and robot rigs, two skins each), Pixel Byte (PNG layers) and Blocky (a VRM 1.0 model built from code). Each has three personalities.

## Run on this Mac

Open `dist/Agent Wardrobe.app` after packaging. Press **⌘⇧S** or click **◈ Skin** to open the App Mod Marketplace. The optional web endpoint retains its port and authorization across restarts. Press **⌘⇧B** to restore desktop chat controls.

For development:

```sh
npm ci
npm start -- --open-wardrobe
```

Drag the character to move the transparent always-on-top window. Stream mode hides controls and lets mouse clicks pass through. Press **⌘⇧B** or use the menu-bar tray to restore controls. The settings gear chooses local URL/model and voice. No microphone permission is required.

## What is working

- Browser previews and applies Annie, Miso, Byte or any other Mod, changes their skins and personalities, and chooses Codex, Claude or LM Studio. Server-sent events synchronize browser and desktop.
- Skin switching preserves engine, chat history and in-progress activity. All engines share a durable local conversation. The next reply uses the selected identity/personality; changing during a reply does not rewrite that request.
- Codex uses a real `codex app-server` process with initialize, ephemeral threads, turn/start and turn/item events. This initial character PoC is chat-only, with tools disabled and no approval execution. It does not yet run coding jobs or attach arbitrary existing Codex windows.
- Claude chat uses its CLI with tools disabled. The browser's **Connect Claude project hooks…** opens a native project picker and installs only observational hooks in `.claude/settings.local.json`. Restart Claude Code in that project after installing. Select Claude in the wardrobe to visualize events from that CLI. Hooks do not change its personality, task instructions, approvals or execution permissions.
- Claude hook observations strip prompts, arguments and transcripts. Stop means resting, not task success. The bridge follows one observed session; a newer UserPromptSubmit becomes the active session. This is not yet a multi-session selector.
- LM Studio remains supported through its local `/models` and `/chat/completions` API. Load a chat model and start its local server first; its animations reflect this app's chat requests, not external coding activities. No cloud fallback occurs.
- Default language follows macOS preferred languages; replies follow the user's current language. Desktop UI has English, Traditional Chinese, Simplified Chinese and Japanese strings; other UI languages fall back to English. Browser UI currently has English and Traditional Chinese; expanded localization is pending.
- System voice, approximate mouth animation, blinking and idle motions. Voice can be disabled. Available voices depend on the installed macOS voices.

Existing CLI logins and plan limits still apply. The app does not store cloud API keys or extract OAuth credentials. Inference calls can consume existing quotas. Hook installation is an explicit local project action through the picker; the firstmate reference repository is not modified automatically. The application menu removes our hooks from the last connected project. If the app moves, reconnect the project to update command paths.

## Hands-free: wake word and dictation

Settings → 語音喚醒. Say the wake phrase (default 「嘿安妮」 or "Hey Annie", following the character's name; custom phrases in Chinese, English or both, comma-separated) and the chat opens. With the speech-recognition model installed, keep talking: the companion listens until a short pause, transcribes the question and sends it. Wake detection uses the bundled 8 MB sherpa-onnx zh-en keyword model; dictation uses SenseVoice int8 (Chinese, English, Japanese, Korean, Cantonese, ~240 MB, downloaded once, pinned and hash-checked) with Silero VAD, converted to Traditional Chinese when the system languages include Traditional Chinese. Everything runs on this Mac; audio stays in memory and is never stored or uploaded. The microphone is open only while wake is enabled (a dot on the toolbar; red while listening), and the companion ignores the microphone while it is speaking. On the synthetic test set, near-miss Chinese phrases did not trigger the wake word; "Hey Andy" can trigger "Hey Annie".

The character can be resized with ⌘-scroll or a pinch over it (60–160%); clicking it opens the chat.

## AI voice

AI settings → 語音 chooses the Edge online voice, the local Kokoro voice, OpenAI AI voice, the macOS voice or no voice.

Edge online voices include Taiwanese Mandarin (曉臻, 曉雨, 雲哲) plus English and Japanese, free and keyless with adjustable speed. They use the unofficial endpoint behind Edge's Read Aloud, so the spoken text goes to Microsoft and the service may break when Microsoft changes it; a 403 from clock skew is corrected once from the server time. First sound is typically under a second.

Kokoro (Kokoro-82M v1.0, Apache-2.0) runs offline through sherpa-onnx: 8 Mandarin and 8 English voices with adjustable speed, text never leaves the Mac. The ~400 MB model downloads once from a pinned Hugging Face revision into the App's userData, its large files are SHA-256 checked, and it is only marked installed when everything verified. Replies are spoken sentence by sentence, so the first sentence plays while the next is generated (about 1.5 s to first sound on an Apple Silicon Mac). Mandarin voices have a mainland accent.

OpenAI: OpenAI offers 13 voices (marin and cedar recommended), three models and, with gpt-4o-mini-tts, a free-text speaking style; ▶ 試聽 previews before saving. The in-app guide links to the OpenAI API keys, billing and usage pages. A pasted key is checked against OpenAI first and saved only if accepted, encrypted with Electron safeStorage (protected by the macOS Keychain) in the App's userData; it is never shown again, never written to settings, and only sent to api.openai.com. Removing the key stops AI speech with a message rather than silently using the macOS voice. OpenAI API usage is billed separately from ChatGPT subscriptions.

## Mod / Skin abstraction

New Mods use `schemaVersion: 2` and ship their own artwork in one of three renderers: SVG parts, PNG layers or a VRM 3D model. See [MODS.md](../MODS.md) for the format, the face contract and validation rules; `mods/annie`, `mods/pixel-byte` and `mods/vrm-sample` are working examples. The notes below describe the original built-in rigs.

Each `mods/<id>/mod.json` has a versioned identity, a registered model (`cat`, `robot`), a list of skins, personalities and default selection. A skin contains six validated color tokens, a known accessory and mappings for idle, working, waiting_for_approval, speaking, success and error. Personality contains static instructions for companion chat.

- `mods.cjs`: manifest validation, catalog, selection and identity prompt.
- `runtime.cjs`: shared selection, provider and activity, independent of rendering.
- `avatars.js` / `avatar.css`: trusted shared SVG rigs and animations used by both desktop and browser.
- `control-server.cjs`: loopback-only authenticated control API and event stream; serves a fixed static-file allowlist.
- `codex-server.cjs`: JSON-RPC adapter; restricted chat and a separate experimental dynamic-tool task session.
- `claude-hooks.cjs` / `hook-client.cjs`: merge/remove installer and nonblocking observer.

To add a skin, extend a bundled manifest with the same declarative fields. To add a new silhouette, register a trusted rig and validation enum before adding its manifest. Downloaded scripts, arbitrary SVG/HTML and external asset URLs are not supported. This is a built-in preview library; paid marketplace, creator upload and untrusted archive imports are not implemented.

## Validation and packaging

```sh
npm test            # unit tests
npm run smoke       # Electron smoke suites, offline set (also run in CI on macos-14)
npm run smoke -- --all   # adds Kokoro/Edge voices and wake+dictation; needs KOKORO_MODEL_SRC,
                         # ASR_MODEL_SRC (verified model folders) and evidence/fake-mic.wav
npm run check       # both
```

CI: `.github/workflows/app.yml` runs unit tests and the offline smoke set on an Apple Silicon runner and uploads smoke screenshots.


```sh
npm test
npm start -- --smoke-test
node scripts/verify-claude-hooks.cjs
npm run build:native
npm run package:mac
```

Tests cover invalid skin data, atomic selection, personality prompts, activity preservation, endpoint authentication, origin restrictions, live event delivery, local-model API behavior, and hook install/uninstall/offline behavior. Native smoke test operates the browser page, switches all three rigs, changes skin/persona, verifies desktop sync and preserves working activity, then checks stream-mode restore. It writes screenshots under ignored `evidence/`.

Live Avatar task verification now confirms official Claude Stop-hook results and real Codex browser tool execution. LM Studio's tool loop is verified against a local HTTP model fixture and a real Chromium test page, not a loaded production local model. Native computer tools are verified against TextEdit with real Accessibility and Screen Recording grants on the packaged app (`--computer-smoke`, see ../VERIFICATION.md); Claude official computer-use was verified end to end from the companion after enabling it in Official Claude setup (one Claude session may hold computer-use at a time). A read-only Claude in Chrome task was also verified from the companion. Codex / LM Studio models driving the native tools and Claude Chrome tasks that click or type have not been verified.

Packaging preserves relative framework symlinks and signs with a local self-signed certificate (create it once with `npm run sign:setup`) so macOS privacy grants survive rebuilds; without it, packaging falls back to ad-hoc and each rebuild needs new grants. It is suitable for local testing; it is not a notarized public release or an installer for other machines.

Every bundled character is an original of this project: Annie, Miso, Byte and Pixel Byte under the repository licence, and Blocky under CC0. Third-party characters are never bundled. Users fetch them through the avatar store under their own licences. See [THIRD_PARTY.md](../THIRD_PARTY.md) for third-party code and runtime downloads.

The full two-week direction and remaining scope are in [POC-PLAN.md](../POC-PLAN.md) and [INTEGRATION-NOTES.md](../INTEGRATION-NOTES.md).

### 從 Avatar 下達操作任務

先在「AI 模型」選 Claude、Codex 或 LM Studio，直接輸入要做的事。模式預設「自動判斷」：角色模型在回覆時判斷這是聊天，還是要交給瀏覽器、電腦或整理存檔任務，需要動手時先回一句確認再開任務。也可在聊天框上方手動指定模式，「只聊天」不會開任何任務。完成結果由目前角色顯示、配合表情並朗讀（可關閉語音），閒置後正常收合。任務錯誤與取消也由角色說明，不把操作日誌當作成功回覆。

| 大腦 | 瀏覽器操作 | 電腦操作 | 結果 |
| --- | --- | --- | --- |
| Claude | 官方 Claude in Chrome | 官方內建 computer-use | 官方 Stop / StopFailure hook → Avatar |
| Codex | App 專用 Chromium 操作工具 | macOS 原生畫面／輸入工具 | app-server 動態工具與最終回覆 → Avatar |
| LM Studio | 同一套 Chromium 操作工具 | 同一套原生工具；模型需支援影像 | 本機 tool-calling 回圈 → Avatar |

Claude 首次可到 AI 設定按「Claude 官方操作設定」，在官方互動介面用 `/mcp` 啟用 computer-use、用 `/chrome` 設定 Chrome 整合。computer-use 需要 macOS、Claude Pro / Max 和系統權限。設定完成後關閉設定視窗，再從角色送任務。日常操作不自動打開 CLI；官方授權提示才開啟確認介面，確認後回到角色，完成時自動隱藏。

Codex 與 LM Studio 不經 Claude 代跑，也不依賴 Peekaboo。兩者的瀏覽器視窗使用 App 專用登入資料，不讀取你現有 Chrome 分頁。原生電腦操作需要 macOS「螢幕錄製」與「輔助使用」權限，AI 設定有開啟對應設定頁面的按鈕；原生輸入在你授權的任務內自動執行，不另加逐次確認。LM Studio 需載入支援 tools 的聊天模型；文字模型可以讀取網頁 DOM，電腦畫面辨識需支援影像的模型。未連線或模型不支援時，角色明確報錯，不自動換雲端。

「詳細紀錄」是選用功能：Claude 顯示官方紀錄，其餘提供者在角色中顯示工具觀察摘要。切換 Mod / 個性作用於下一個工作階段。

任務進行中，角色旁會出現 **停止** 按鈕（平常隱藏），或按全域 **⌘⇧X**。會中止本 App 的 Claude 工作階段，或取消 Codex / LM Studio 的模型請求與操作工具。直播穿透模式仍可用快捷鍵。

官方文件：[Claude computer-use](https://code.claude.com/docs/en/computer-use)、[Claude in Chrome](https://code.claude.com/docs/en/chrome)、[Codex app-server](https://learn.chatgpt.com/docs/app-server)、[LM Studio tools](https://lmstudio.ai/docs/developer/openai-compat/tools)。Codex 使用公開的 experimental dynamicTools 介面，未接入 Codex Desktop 私有的內建 Computer Use / Browser。

操作任務預設 Claude `auto`；Codex 使用 `workspace-write`、`on-request` 與 `auto_review`。這只設定 App 自己的工作階段，不修改全域 CLI 設定。Codex 的 App 原生 GUI 工具在主程式執行，不代表每個 GUI 動作都經過 Codex 自動審查。系統隱私權和 Claude Chrome 的網站授權仍由官方流程處理。

角色氣泡顯示 AI 寫給使用者的中途說明與結果；Claude 透過官方 MessageDisplay hook 接收文字，Codex / LM Studio 使用模型的中途說明。工具名稱與 Running 狀態留在詳細紀錄，不進入角色氣泡；不解析終端、不顯示隱藏推理。任務途中直接送出訊息即可補充指示：Codex 使用 turn/steer，LM Studio 在下一輪模型請求套用並略過尚未執行的舊動作，Claude 在官方互動輸入中排隊。首次設定或等待官方授權時需先完成提示。已經執行的動作無法靠插話撤回；要立即中止請按緊急停止。

對話記憶保存在 App userData 的 `conversation-history.json`，採用原子寫入與 0600 權限。重啟、換角色或切換 Claude / Codex / LM Studio 會保留；聊天、操作要求、途中插話、角色進度與最終結果都會保存。模型使用最近對話加上與當前問題相關的較早紀錄，總紀錄上限 2,000 則。首次升級會補回 App 自己工作目錄的 Claude 人類對話，不導入其他專案或工具輸出。按「清除對話」會刪除 App 記憶，之後不會再次導入舊紀錄；這不刪除 Claude 原有的 CLI 紀錄，也不恢復未完成操作。

對話可拖曳選取任意文字，以 ⌘C 或右鍵複製。按 **⌘⇧Enter** 可從其他 App 喚回角色並聚焦輸入框。使用已安裝 Typeless 的語音快捷鍵即可把語音文字送進輸入框；Enter 送出，Shift+Enter 換行。**🎙 語音模式** 開啟時，原生貼入文字會在 800 毫秒後自動送出（包含一般貼上），可作為目前任務的插話；模式關閉則保留草稿。錄音與轉寫由 Typeless 完成，此按鈕不直接啟動錄音。

整理資料與文件輸出：在角色裡說「幫我整理上次找的冰箱，做成比較表並存到桌面」，或選「整理資料／存檔」。輸出預設位於 `桌面/Agent Wardrobe/日期_任務名稱_識別碼/`，通常是 Markdown 報告及 CSV 表格，也支援 TXT / JSON。Claude 使用 App 自帶的文件 MCP 工具，Codex / LM Studio 使用相同的文件存檔工具；不需再安裝服務。只有實際存檔成功才顯示「📁 開啟資料夾」，會用 Finder 開啟；文件名稱、資料夾與按鈕隨對話保存，重啟後仍可使用。相同檔名會另存編號版本，不覆蓋現有文件。存檔錯誤由角色顯示；LM Studio 需支援工具呼叫。

角色文件入口：點角色工具列的 **📁** 或按全域 **⌘⇧O**，開啟原生文件視窗。可按任務名稱或檔名搜尋、點檔名以預設 App 開啟、開啟任務資料夾、在 Finder 顯示文件，或打開桌面輸出根目錄。文件清單來自 App 的存檔紀錄，不需保留舊對話；已刪除的文件不列出。⌘F 聚焦搜尋，Esc 關閉視窗。
