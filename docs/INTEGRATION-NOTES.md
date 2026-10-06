# 三種引擎接入與 firstmate 參考

2026-10-02 使用者指定 Claude hooks、Codex App Server，並要求保留 LM Studio。本輪唯讀檢視 `/Users/benjamin/Desktop/firstmate-workflow`，未啟動其工作流、安裝 hooks 或修改該專案。

## 來源與證據界線

| 來源 | 已看到的內容 | 如何使用 |
|---|---|---|
| `bin/lib/fm_hooks.py` | 合併專案級 hooks、保留其他設定、重複安裝不變、只移除自有項目、quote 路徑 | 參考 installer 與回歸案例，另寫本產品的觀察 hooks |
| `docs/verification/supervision.md` | Claude Stop／UserPromptSubmit、進程所有權；區分基本實測與尚未 live 驗證的安裝流程 | 不以設定檔存在就宣稱接通；避免孤兒进程 |
| `design/tasks/T-150.json` | App Server turn/start、turn/steer、turn/completed 設計，及先前 spike 的同 session 延續敘述 | 參考受管理 session 接法，不当作 checkout 已有完整實作 |
| `bin/adapters/codex.sh` | 目前仍使用 codex exec | 不能當 App Server adapter 直接搬用 |
| `bin/adapters/claude.sh` | 單次受限 claude -p worker 路徑 | 不直接套用到使用者互動 CLI |

supervision 文件對 Codex hooks／既有 TUI 推送仍標示未驗證。與 T-150 設計敘述不能合併推論成「所有既有 Codex 視窗均能接入」。

## Claude：觀察 hooks

在選定專案 `.claude/settings.local.json` 合併自有命令 hooks，保留 firstmate 與其他設定。安裝／移除可重複，精確辨識自有項目，不用寬鬆命令比對刪其他人的 hooks。依實際版本驗證以下候選事件後才註冊；這不是 firstmate installer 已提供全部事件的意思。

| hook | 角色反應 | 限制 |
|---|---|---|
| SessionStart | 已連線 | 綁 session_id／cwd，不代表工作中 |
| UserPromptSubmit | 工作中 | 不推測內部思考 |
| PreToolUse／PostToolUse | 工具活動 | 單一工具完成不等於任務成功 |
| PermissionRequest 或支援的權限通知 | 等待批准 | 驗證事件與 payload 後才映射 |
| PostToolUseFailure | 工具錯誤反應 | Agent 仍可能恢復，不直接結束 turn |
| Stop | turn 結束候選／休息 | 其他 hook 可阻擋；不能直接慶祝任務成功 |
| SessionEnd | 離線 | 不畫成完成 |

觀察 hook 只讀 stdin、發最小事件並快速正常退出。桌面橋接離線／逾時也不能阻擋 CLI。不輸出 additionalContext、decision:block、exit 2 或 asyncRewake；firstmate 的 guard／wake 是不同用途，不能因换 Skin 而接管它們。Stop 後若有新活動，角色回工作中。

本機橋接用 loopback、啟動時隨機 token、payload 大小限制。預設只傳 session、事件類型、時間與工具分類，不傳 prompt、工具參數、全文路徑或 transcript。Skin 不持有 token；展示「讀取檔案／編輯／執行工具」等分類已足夠首版，不先抓全部工作內容。

## Codex：受管理 App Server

桌面主程序擁有 `codex app-server` 連線與進程。依安裝版本 schema 完成 initialize／initialized、thread/start 或 thread/resume、turn/start 及通知處理。中途送訊息才需要 turn/steer；換 Skin 不送訊息、不改原任務。

- 以 threadId、turnId、itemId、RPC request id 綁定事件與批准要求。
- turn／item 活動映射工作；item 結束不等於整個 turn 結束。
- 官方批准請求保留實際操作與使用者選擇，角色不能自動批准。
- turn/completed 核對 status／error，區分 completed、failed、interrupted；turn 完成仍不代表產品任務已驗收。
- 只顯示允許的文字／工具狀態，不展示或推測私密 chain-of-thought。
- 斷線標示未知／離線；清理自有資源，不終止其他 session。
- 不承諾新 App Server 能附著任意官方 App 或既有 TUI；初版以自有工作階段為驗收範圍。

## LM Studio：保留本機 API

沿用目前 `ai.cjs` 本機 URL、model 列表、chat completions。使用者先在 LM Studio 載入模型並開啟服務；App 選本機引擎後套用同一 Mod／Skin／個性。角色狀態来自本 App 的請求、回覆、語音與錯誤，不假裝有外部工具或批准事件。模型能力與硬體效能需另驗證。

語言採電腦偏好與目前對話語言；換引擎保留外觀與偏好。不同提供者的對話不自動互傳。LM Studio 未連線、沒有聊天模型或回覆逾時時明確提示，不偷偷退回雲端。

## D1–2 驗證輸出

1. Claude 真實 CLI hook 樣本、橋接離線不阻擋、與原 hooks 並存、重複安裝與移除安全。
2. Codex App Server 真實 turn、工具活動、批准／回覆、成功／失敗、退出樣本與版本。
3. LM Studio 模型列表與真實對話，驗證模型缺失與連線失敗；本機界面仍能套用 Skin。
4. 共用 mapper 回歸 session 隔離、重複／過期事件、工具失敗後恢復、Stop 被其他 hook 阻擋、斷線、換 Skin 不改工作。

## 官方契約

- [Claude hooks](https://code.claude.com/docs/en/hooks)
- [Codex App Server](https://developers.openai.com/codex/app-server/)
- LM Studio API 接法在本機版實測並於開發時校對官方文件；本輪未驗證本機模型已載入。

本地 firstmate 是參考模式，官方 schema 與實際版本才是新 adapter 的介面契約。

## 第一輪實作結果

新增自有 `claude-hooks.cjs`／`hook-client.cjs`，參考設定合併模式但不複製 firstmate 的 guard／wake；提供原生專案 picker，沒有修改 firstmate 專案。安装／移除與 fail-open 以測試驗證，live 請求被 Claude 每週額度限制阻擋。

`codex-server.cjs` 已用本機 App Server 完成握手、ephemeral thread、turn/start、agentMessage 和 turn/completed 真實角色對話。這台安裝版本的 sandbox 值是 `read-only`，不是文件某些範例的 `readOnly`；以本機 schema／實測為準。仍為禁用工具的聊天 PoC，編程任務與批准介面保留在下一里程碑。

LM Studio 接口保留於 `ai.cjs`，未偷偷退回雲端；本機連線檢查回 fetch failed，live 模型驗證待伺服器可用。

## Official interactive operation adapter

`agent-session.cjs` launches the installed official Claude CLI in a real PTY through `agent-pty.py` (Python standard library). User tasks are literal positional arguments after `--`, never shell commands or terminal keystrokes injected into an unknown prompt. Browser mode adds `--chrome`; computer mode uses the built-in per-project computer-use integration. Both default to Claude Auto permissions. Agent console is a sandboxed local Electron window with sender-bound IPC; no arbitrary executable or working-directory parameters cross the renderer boundary.

The session workspace lives under App userData. Observation hooks are installed only there, with a generated CLI session UUID; active task hooks must match this UUID. Task execution never routes through the existing chat-only Codex server or Claude print adapter. Concurrent new tasks are rejected; active tasks accept scoped steering messages. Official approval input remains human driven. Owned process groups terminate on Stop, console close, stdin EOF or App exit. No third-party automation backend is connected.

Task outcomes come from official Stop.last_assistant_message and StopFailure fields. Owned sessions additionally use the official MessageDisplay hook to relay assistant display text while it streams. Message IDs and indices assemble display batches without replaying duplicate or stale text; matching final outcomes replace the same intermediate bubble. Tool lifecycle events affect activity only; standalone tool status lines are filtered out of prose and raw tool names remain in detailed logs. External project hook installations omit MessageDisplay. Only the App-owned project opts into result forwarding; external project hooks remain metadata-only. Session IDs, cancellation and completion gates discard stale, duplicate and post-stop results. The renderer receives plain text, shows it through the selected avatar and uses macOS speech without an extra cloud summarization request. Missing results are errors, not successful actions. CLI is hidden by default; official PermissionRequest/permission notifications open the official UI, while first-run trust/login setup has a no-hook timeout fallback. Explicit setup keeps an interactive session open without an initial task.

## Codex / LM Studio operation adapters

`task-agents.cjs` drives a separate Codex App Server session with experimental dynamicTools, or the LM Studio OpenAI-compatible tool loop. Restricted chat remains separate. Codex built-in shell, filesystem execution, apps and external MCP servers remain disabled. Host calls are isolated to the owned thread/turn. LM Studio receives tool observations locally; vision observations require a model supporting image messages. Neither provider routes through Claude.

`operation-tools.cjs` offers bounded, validated browser and native desktop primitives. Browser operations target a sandboxed, task-owned Electron Chromium window with a separate persisted profile, no Node/preload bridge, fixed observation code and HTTP(S)-only navigation. Password fields require human entry. Native screenshots use Electron desktop capture; a signed Swift helper posts fixed CoreGraphics events only after Accessibility checks within the user-authorized task, without additional per-action App approval. The app observed in the latest screenshot is restored before native input so interacting with Avatar does not redirect typing into the companion. Screenshots map pixels to logical primary-display coordinates. No arbitrary shell, script or executable arguments cross the tool boundary.

Tool calls are serialized. Emergency stop aborts fetches,  kills the owned app-server/session/helper and prevents queued actions or late results. Progress and provider commentary appear in Avatar; final outcomes remain separate from optional detailed logs. Native screen/input execution depends on OS grants; model capability errors surface through the character.

ConversationStore is the authoritative local memory for all providers and skins. Main-process handlers append accepted task/chat/steering text before responses, persist assistant display updates by message ID, and deduplicate matching final outcomes. Renderer restores visible messages at startup. Model context comes from this store, not renderer-supplied history; the current user request stays last. Recent messages plus keyword-matched older entries fit the existing adapters' 20-message budget. One-time Claude transcript migration is constrained to the exact App workspace and text-only user/assistant entries; sidechains, metadata and tool blocks are omitted. Explicit clearing marks migration complete so old conversations cannot reappear.

Native Edit menu and a selection-bound context menu support copy/paste. The input uses a textarea with composition-aware Enter handling. A separate global focus shortcut restores the role for external dictation. Optional voice mode submits trusted native paste events only, after a delay, through the same chat/task-steer paths; it does not record audio or assume access to a Typeless API. Voice mode and active text selection keep the bubble open.

Document outputs: OutputStore creates a per-task private manifest under userData and lazily creates a dated task folder beneath Desktop/Agent Wardrobe only when a requested document is saved. report_save is available in browser, computer and files tasks; Claude receives a scoped stdio MCP server via --mcp-config without replacing official Chrome/computer integrations, while Codex/LM Studio use the host dynamic/function tool. The save API accepts only plain Markdown/CSV/TXT/JSON filenames and bounded text, validates JSON, excludes traversal/symlinks, uses exclusive writes and verifies persisted paths. Completed/cancelled tasks close their manifest to prevent subsequent writes. Finder IPC accepts only manifest IDs, not renderer paths. Final outcomes attach verified artifacts to persistent conversation history; restored context includes their saved locations. Chat recognizes direct organize/export requests and routes them into an operation task, preserving progress, steering and emergency stop. The files mode explicitly reports an error if no document was produced.

Native files window: src/renderer/files/files.html/js/css runs in an Electron window with a dedicated minimal preload, sandbox, no Node integration and no navigation/popups. Sender-bound IPC exposes catalog search, manifest-scoped opening/reveal, root-folder opening and close. OutputStore resolves only recorded files with supported extensions; renderer-provided arbitrary paths are not accepted. Catalog persists independently of conversation history and hides missing files. The role toolbar, tray, application menu and global Cmd+Shift+O shortcut reuse one window; task completion refreshes its catalog.

## 開發夥伴: attaching to an existing Claude Code / Codex session

Verified 2026-10-06 against Claude Code 2.1.290 and codex-cli 0.159.3, on throwaway sessions in a temp folder.

**Discovery (`dev-sessions.cjs`).** Claude: `~/.claude/projects/*/<uuid>.jsonl`, reading only the first 256 KB and last 128 KB (sessions reach hundreds of MB). The folder is the records' `cwd`, never the decoded directory name. Title: `custom-title` › `ai-title` › `summary` › first real prompt. `agent-*.jsonl`, `<session>/subagents/` and sidechain-only files are skipped; the last `permission-mode` record is kept. Codex: `thread/list` (`sortKey: updated_at`, `useStateDbOnly: true`) from a short-lived app-server; the fallback reads `~/.codex/sessions/**/rollout-*.jsonl` (`session_meta` + first non-injected user message, names from `session_index.jsonl`), skipping `exec` and subagent threads. "Possibly still open": written in the last 3 minutes, a running `claude` / `codex` whose command line names the id, or the newest session of that tool in a folder where it runs (`ps` + `lsof -d cwd` on macOS, `/proc/<pid>/cwd` on Linux, command lines only on Windows). The app's own children are excluded.

**Claude (`dev-session.cjs`).** One process per attach: `claude -p --resume <id> --input-format stream-json --output-format stream-json --verbose --include-partial-messages --permission-prompt-tool mcp__wardrobe_permission__approve --mcp-config <file>`, plus `--permission-mode <mode>` when the session recorded acceptEdits / auto / plan / manual / dontAsk. Never `--dangerously-skip-permissions` or `--fork-session`. Each message is a stream-json `user` line; `system:init` arrives per turn; `stream_event` text deltas, `assistant` tool_use, `user` tool_result and `result` map to the shared events. Interrupt is the stream-json `control_request {subtype:"interrupt"}` (answered by `control_response`, then `result: error_during_execution`); the process is ended if no result comes within 5 s, and the next message resumes again. Real run: the resumed session kept its id and appended to the same jsonl; no new session file was created.

The CLI path was chosen over `@anthropic-ai/claude-agent-sdk`: the SDK runs the same CLI with the same stream-json protocol, but would add a dependency and its own bundled CLI to the app, while this uses the exact `claude` the user signed in to and that wrote the session.

**Permission tool (`permission-mcp.cjs`).** Claude Code starts it from `--mcp-config` as a stdio MCP server with one tool, `approve`, receiving `{tool_name, input, tool_use_id}`. It forwards the request over a Unix socket (`permission.sock` in a 0700 temp folder, mode 0600; a random named pipe on Windows) with a per-attach 32-byte token read from a 0600 file, and returns `{"behavior":"allow","updatedInput":<original input>}` or `{"behavior":"deny","message":…}` as the tool's text content (shape confirmed with the real CLI writing a file after an allow). No answer, no app or a bad answer is a deny; the tool never allows on its own and the app cannot change the input.

**Codex.** Its own `codex app-server --stdio` with the user's config, `initialize` / `initialized`, `thread/resume {threadId, excludeTurns: true}` without sandbox, approval or model overrides, `turn/start` per message, `turn/interrupt {threadId, turnId}`, `thread/unsubscribe` on leave. `item/agentMessage/delta`, `item/started` / `item/completed` (commandExecution, fileChange, mcpToolCall, webSearch) and `turn/completed` map to the shared events. Server requests `item/commandExecution/requestApproval` and `item/fileChange/requestApproval` (diff from the matching `item/started`) are answered `{decision:"accept"|"decline"}`, `item/permissions/requestApproval` with the requested profile or none; every other server request (user-input forms, MCP elicitation, dynamic tools) gets JSON-RPC -32601. With `approvals_reviewer = "auto_review"` in the user's config, Codex's own reviewer answers and no request reaches the app (seen in the real run); the picker's opt-in resumes with `approvalsReviewer: "user"`, after which the real CLI sent `item/commandExecution/requestApproval` and ran the command only after the app's accept.

**In the app (`dev-companion.cjs`, `dev-speech.cjs`).** While attached, chat turns from the desktop, the wake word / dictation and the phone go to the session; tasks are refused until leaving. Pending approvals are answered by the card buttons, the phone, or short spoken / typed 允許 / 好 / 可以 / yes or 拒絕 / 不要 / no; any other text is held back (「請說允許或拒絕」). 「停下來」 and the emergency stop interrupt and deny what is pending. Replies are spoken through `speakable()` (code blocks, tables, links and long paths replaced, capped with 「完整內容在聊天框」); tool one-liners are limited to one per 25 s, none in the first 6 s of a turn, never over speech. The attached session is saved in settings and offered again at start-up, never reattached silently. Leaving or quitting kills the process tree. Outputs are capped (8 MB per line, 200 000 characters per message).

**Limits.** A session open in a terminal at the same time forks: both programs append to it. The warning is a heuristic (and on Windows has no folder check). One turn at a time; a message while a turn runs is refused (say 「停下來」 first). Claude's MCP tool timeout applies to a pending approval left unanswered for very long; when it expires Claude treats the request as failed, never as allowed.
