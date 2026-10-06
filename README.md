# Agent Wardrobe

A desktop AI companion for macOS, Windows and Linux. A small character lives in the corner of your screen: it chats, speaks with a voice of its own, wakes when you call its name, and can carry out tasks in a browser or on the desktop. You can also control it from your phone.

Characters are **Mods**. A Mod is drawn in SVG or layered PNG, or is a VRM, glTF, Live2D or MMD model. You can draw a new character from a photo with AI, find one in the avatar store, or make your own and contribute it.

> **No third-party characters ship with this repository.** The bundled characters are original to this project. Anime, game and VTuber characters, models and voices come from outside sources: you download them yourself, and you are responsible for following their licences. See [Characters, voices and licences](#characters-voices-and-licences).

## Requirements

- **macOS** 13+ on Apple Silicon (the main platform; Intel Macs mostly work).
- **Windows** 10 / 11, x64.
- **Linux** x64 (arm64 where noted) with glibc 2.32+ (Ubuntu 22.04+, Debian 12+). The local speech engine (sherpa-onnx) needs it.
  - The transparent companion needs a compositing desktop (GNOME, KDE, Wayland…). Without one, the companion is an opaque panel.
  - Optional packages: `espeak-ng` for the system voice, `libarchive-tools` (bsdtar) to open .7z / .rar downloads.
- Node.js 20 (for development).

### What works where

| Feature | macOS | Windows | Linux |
| --- | --- | --- | --- |
| Companion window, chat, characters, Mod marketplace, avatar store | ✓ | ✓ | ✓ (opaque panel without a compositor) |
| Built-in local model (llama.cpp) | ✓ Metal | ✓ Vulkan when a GPU driver provides it, else CPU | ✓ x64: Vulkan when `libvulkan.so.1` exists, else CPU; arm64: CPU |
| Codex / Claude / LM Studio brains | ✓ | ✓ | ✓ |
| Claude computer / browser tasks (Claude Code in a terminal) | ✓ | — (needs a pty) | ✓ |
| Codex / local-model tasks | ✓ | ✓ | ✓ |
| 開發夥伴 (attach a Claude Code / Codex session) | ✓ | ✓ (no folder check for the terminal warning) | ✓ |
| Native computer-use input (mouse and keyboard) | ✓ | see the computer-use notes | see the computer-use notes |
| System voice | `say` | Windows SAPI voices (zh-TW / ja / en when installed) | `espeak-ng` (or `spd-say`) |
| Edge, OpenAI, ElevenLabs, Kokoro voices | ✓ | ✓ | ✓ |
| VOICEVOX | ✓ | ✓ CPU, NVIDIA build with an NVIDIA GPU | ✓ CPU (x64 / arm64), NVIDIA build with an NVIDIA GPU |
| CosyVoice, GPT-SoVITS | ✓ CPU | ✓ x64: CUDA with an NVIDIA GPU, else CPU | ✓ CUDA with an NVIDIA GPU, else CPU |
| Wake word and SenseVoice dictation | ✓ | ✓ | ✓ |
| Typeless dictation | ✓ | — (Mac app) | — (Mac app) |
| Phone remote (Tailscale) | ✓ | ✓ | ✓ (`sudo tailscale set --operator=$USER` once) |
| Reading PDF terms in downloads | ✓ (Spotlight) | listed as 「沒讀到（請自己看）」 | listed as 「沒讀到（請自己看）」 |
| .7z / .rar downloads | ✓ | ✓ (Windows' bsdtar) | with `libarchive-tools` |

Spoken audio plays inside the app on every platform. Shortcuts shown as ⌘⇧S on a Mac are Ctrl+Shift+S on Windows and Linux.

## Run it

```sh
npm ci
npm start
```

On first launch, a short guide sets up the brain, the voice, the wake word and speech recognition. You can reopen it from **Settings → 一般 → 重新看使用引導**.

### Build the app

```sh
npm run sign:setup      # once: a local self-signing identity, so macOS permissions survive rebuilds
npm run package:mac     # → dist/Agent Wardrobe.app (signed for this Mac only)
```

To build for other Macs, use an Apple Developer ID:

```sh
xcrun notarytool store-credentials agent-wardrobe   # once: Apple ID, team ID, app-specific password
AGENT_WARDROBE_SIGN_IDENTITY="Developer ID Application: Your Name (TEAMID)" \
AGENT_WARDROBE_NOTARY_PROFILE=agent-wardrobe \
AGENT_WARDROBE_BUNDLE_ID=com.example.agent-wardrobe \
npm run package:mac -- --release
```

This signs every binary with the hardened runtime and the entitlements in `build/entitlements.mac.plist`. It then notarizes and staples the app, and writes `dist/Agent Wardrobe.zip`.

#### Windows

Build on Windows (x64) with Node.js 20. The C# input helper compiles with the `csc.exe` that ships with Windows, so no SDK is needed.

```powershell
npm ci
npm run build:native    # → bin\native-input.exe (computer use)
npm run package:win     # → dist\Agent-Wardrobe-<version>-win-x64.zip, plus dist\Agent-Wardrobe-Setup-<version>-x64.exe if NSIS 3 is installed
```

The zip is a portable app: unzip it anywhere and run `Agent Wardrobe.exe`. The installer installs for the current user only, in `%LOCALAPPDATA%\Programs\Agent Wardrobe`, so it needs no admin prompt. It adds a Start menu entry and an uninstaller.

Signing is optional:

- **A certificate file:** set `WINDOWS_CERTIFICATE_FILE` (a `.pfx`) and `WINDOWS_CERTIFICATE_PASSWORD`.
- **Azure Trusted Signing:** set `AZURE_SIGNING_DLIB` (the `Azure.CodeSigning.Dlib.dll` path) and `AZURE_SIGNING_METADATA` (its `metadata.json`).

`signtool` comes from the Windows SDK, or from the path in `SIGNTOOL`. An unsigned build runs, but Microsoft Defender SmartScreen warns the first time: choose **More info → Run anyway**. A signed build still warns until its certificate has built up reputation.

#### Linux

Build on Linux (x64 or arm64) with Node.js 20:

```sh
npm ci
npm run package:linux   # → dist/agent-wardrobe-<version>-linux-x64.tar.gz, plus an AppImage if appimagetool is on PATH (or set APPIMAGETOOL)
```

- **tar.gz:** extract it to `/opt/agent-wardrobe`, and copy `agent-wardrobe.desktop` to `~/.local/share/applications/` and `agent-wardrobe.png` to `~/.local/share/icons/`. Chromium's sandbox needs `chrome-sandbox` to be setuid root: run `sudo chown root:root chrome-sandbox && sudo chmod 4755 chrome-sandbox`, or start the app with `--no-sandbox`.
- **AppImage:** make it executable and run it. An AppImage can't carry a setuid sandbox. It starts with `--no-sandbox` only when the system blocks unprivileged user namespaces, as Ubuntu 23.10 and later do.

#### Releases

`.github/workflows/release.yml` runs on a `v*` tag. It builds macOS (Apple Silicon), Windows and Linux, and attaches them to a **draft** GitHub Release for you to review and publish. A manual run (**Actions → release → Run workflow**) builds the same files and only keeps them as workflow artifacts. Without signing secrets, the builds are unsigned (ad-hoc on macOS); the workflow file lists the secrets it uses.

Every build ships the wake-word model, the bundled Mods and the vendored renderers. Engines and models that download on first use are never bundled: llama.cpp and Qwen, VOICEVOX, CosyVoice and GPT-SoVITS, the Kokoro and speech-recognition models, and Live2D's Cubism Core. `scripts/package-common.cjs` holds the shared file list for all three platforms.

## Features

### Brains

| Brain | Cost | What you need |
| --- | --- | --- |
| Built-in local model | Free | Pick a Qwen model (2B / 4B / 9B / 35B-A3B). It downloads once, runs with llama.cpp on the Mac, and nothing leaves the Mac. |
| Codex | Your ChatGPT plan | Codex CLI, signed in |
| Claude | Your Claude plan | Claude Code, signed in |
| LM Studio | Free | LM Studio with a model loaded and its server running |

Codex and Claude use your existing subscription through their official CLIs. If a CLI is missing, **Install and sign in** opens a terminal with the official installer: Terminal on macOS, Windows Terminal or PowerShell on Windows (`irm https://claude.ai/install.ps1 | iex`, `irm https://chatgpt.com/codex/install.ps1 | iex`), the first terminal emulator found on Linux. With no terminal, the app copies the command for you to paste.

### Chat and tasks

- The character picks an emotion for every reply. In auto mode it decides whether a request needs a browser, desktop or files task.
- Tasks write their output to `~/Desktop/Agent Wardrobe/`. ⌘⇧X stops a task.
- Replies can be in Traditional Chinese, Simplified Chinese, English or Japanese, or follow your language.

### 開發夥伴: the character becomes one of your coding sessions

🧑‍💻 in the toolbar (or **Settings → AI 大腦 → 開發夥伴**) lists your recent Claude Code and Codex sessions. Pick one and the character *is* that session: it continues in the project folder with the full conversation, through your installed and signed-in `claude` / `codex`.

- Typing, the wake word, barge-in and follow-up listening all go to the session. Replies are spoken without code blocks or long paths; long ones end with 「完整內容在聊天框」.
- Tool activity shows as a status line, and now and then a short spoken line (「我在跑測試」).
- Permission requests appear as a card with 允許 / 拒絕 and are asked aloud; say 允許 / 好 / 可以 or 拒絕 / 不要 while one is waiting. Nothing is approved without you. The phone shows and answers them too (with 「允許手機下達電腦任務」 on).
- 「停下來」 or ■ interrupts the running turn; 離開 goes back to the usual brain. The session stays resumable in a terminal (`claude --resume <id>`, `codex resume <id>`). After a restart the app offers to reattach; it never does so by itself.
- The session keeps its own settings: Claude Code's permission mode (a session saved in bypassPermissions is resumed in the normal asking mode), Codex's sandbox and approval policy. If your Codex config hands approvals to its automatic reviewer, you can tick 「需要批准的動作一律問我」 in the picker.
- Close the session in its terminal first: two programs writing the same session fork the conversation. The picker warns about sessions written in the last few minutes or used by a running `claude` / `codex`.

### Computer use

Desktop tasks (Codex and LM Studio brains) look at the primary display and use the native mouse and keyboard:

| Platform | Support | Needs |
| --- | --- | --- |
| macOS | Full | Screen Recording and Accessibility permission (buttons in Settings) |
| Windows 10 / 11 | Full, DPI-aware | Nothing extra: `bin\native-input.exe` (SendInput) ships with the app |
| Linux, X11 session | Full | `xdotool` (`sudo apt install xdotool`). CJK and emoji are typed by pasting through the clipboard, which is restored afterwards |
| Linux, Wayland session | Unavailable | Wayland doesn't let apps move the pointer or type into other windows. Log in with an X11 session (for example "Ubuntu on Xorg") to use it |

When computer use is unavailable, the **電腦操作 / Computer use** task mode is greyed out with the reason, on the desktop and on the phone. On Windows and Linux, the model's `command` modifier means Ctrl, and `option` means Alt. Screenshots use Electron's screen capture on every platform.

### Characters

- **Mod marketplace** (⌘⇧S) has two pages: **My characters** and the **Avatar store**.
- **Draw a character from a photo.** Codex draws a new chibi character in the house style from a photo of a friend. The photo is deleted afterwards. Ask the person first.
- **New skin from a photo of clothes.** The character keeps its face and hair and gets the outfit from the photo.
- **Edit with words.** Change any character or skin by asking ("shorter hair", "red jacket"). Bundled characters are copied, never changed.
- **Renderers:**
  - SVG and layered PNG (2D)
  - VRM 0.x / 1.0, glTF / GLB and MMD `.pmx` (3D)
  - Live2D Cubism 3+
- **Motions:** included motion files play — `.vrma` for VRM, `.vmd` for MMD, Live2D motion groups, and glTF clips.

### Avatar store

You search the store from the app. Every result shows its licence, the store never downloads anything you didn't pick, and nothing is redistributed by this project.

| Source | What | How |
| --- | --- | --- |
| VRoid official samples | VRoid's CC0 sample characters | Direct download |
| [VRoid Hub](https://hub.vroid.com) | Anime VRM characters whose authors allow use in other apps | You register your own VRoid developer app and sign in |
| [Open Source Avatars](https://www.opensourceavatars.com) | CC0 VRM avatars | Direct download |
| [Sketchfab](https://sketchfab.com) | CC0 / CC BY character models | Search is open; downloads need your own API token |
| Safebooru | Anime pictures (general rating) | Reference only: Codex redraws a new original character from it |
| Booth, nizima, ニコニ立体, 模之屋, BowlRoll, Gumroad, Picrew, official character sites | VRM, Live2D, MMD and pictures | **AI-assisted download:** the site opens in an in-app window, you sign in and download yourself, and the app unpacks the file and has the AI summarise the terms before import |

### Voices

| Engine | Where it runs | Notes |
| --- | --- | --- |
| System voice | On the computer | macOS `say`, Windows SAPI, Linux `espeak-ng` |
| Edge online voices | Microsoft | Free, includes Taiwanese Mandarin |
| OpenAI TTS | OpenAI | Your API key, stored encrypted |
| Kokoro | On the Mac | Mix voices into new ones (pitch, blend, speed) |
| VOICEVOX | On the Mac | Japanese character voices. Each character has its own terms and credit line. |
| CosyVoice | On the Mac | Clone a voice from about 10 s of recording |
| GPT-SoVITS | On the Mac | Train from a few minutes of recording, or import a voice model |
| ElevenLabs | ElevenLabs | Clone or design a voice with your own paid account |

- Each character can have its own voice.
- **Cloning a real person's voice needs that person's consent.** The app asks first, keeps cloned voices on this Mac only and never exports them.

### Wake word and dictation

- Say 「嘿安妮」 or a phrase of your own, then just talk.
- Wake detection and speech recognition (SenseVoice) run on the Mac, and audio is never stored.
- If you use [Typeless](https://www.typeless.com), it can take over dictation after the wake word.

### Phone remote

**Settings → 手機遙控** publishes a small app to your own devices through [Tailscale](https://tailscale.com) (`tailscale serve`, HTTPS, your tailnet only). You pair a phone once with a QR code. From the phone you can:

- chat;
- change characters, skins and voices;
- draw a character or record a voice with the phone's camera and microphone;
- browse the avatar store;
- view task results and open the links in them.

### Experimental: the character plays games

- **Lane Dash** is our own three-lane runner. [Laya](https://huggingface.co/convaiinnovations/laya) (Apache-2.0) or [Jev](https://docs.typesafe.ai) picks the moves. Install Laya with `npm run laya:setup`.
- **Pikachu Volleyball** opens [gorisanson's web remake](https://github.com/gorisanson/pikachu-volleyball) from its own website; no game assets are bundled. Pikachu is © Nintendo / Creatures / GAME FREAK / The Pokémon Company.
- **Watch mode:** the character watches the game you are playing and comments without spoilers.

More detail: [docs/FEATURES.md](docs/FEATURES.md).

## Characters, voices and licences

**What ships here.** The characters in `mods/` are original to this project and openly licensed. Each Mod states its licence in `mod.json`. The Mod check (`scripts/check-mods.cjs`) rejects bundled Mods without an open licence.

**What you bring yourself.** Characters, 3D/Live2D/MMD models, pictures and voices from VTubers, anime, games or any other third party are **not** included and must not be contributed as bundled Mods. When you get them through the avatar store, AI-assisted download or your own files:

- **You must follow the licence of each item.**
  - VRoid Hub conditions, VN3 licences on Booth, each VOICEVOX character's terms, Live2D's sample-model licence, Unity-chan's UCL, 模之屋's terms, and so on.
  - Common conditions: credit lines, personal use only, no commercial use or streaming, no modification, no redistribution, no adult or violent use.
- **The app shows the terms it knows about.** It keeps them, and the credit line, with each character or voice. A licence summary written by the AI is a convenience, not legal advice. **The original terms always win.**
- **Fan art and fan-made models of existing characters** (including most community voice models trained on anime dubs) are for **personal use only**. The app labels them that way.
- **Characters drawn from photos of real people, and cloned voices,** need that person's consent. They stay private on your Mac.
- **Don't publish, stream or sell** a character or voice unless its licence allows it.

Third-party code and the models downloaded at runtime (Live2D Cubism Core, Kokoro, SenseVoice, Qwen, VOICEVOX, CosyVoice, GPT-SoVITS, Laya…) are listed with their licences in [THIRD_PARTY.md](THIRD_PARTY.md). The Live2D Cubism Core is never bundled: the app downloads it from Live2D only after you accept Live2D's licence.

## Make a Mod

[MODS.md](docs/MODS.md) describes the format. [CONTRIBUTING.md](CONTRIBUTING.md) explains how to submit one. Contributed Mods must be your own work, or openly licensed with the source stated.

## Development

```sh
npm test                 # unit tests
npm run smoke            # Electron smoke suites, offline set (CI runs this on macOS, Windows and Linux; Linux: xvfb-run -a npm run smoke)
npm run smoke -- --all   # adds suites that need real models or apps
node scripts/check-mods.cjs [mods/<id> ...]   # validate Mods without starting the app
```

| File | Role |
| --- | --- |
| `main.cjs` | Windows, settings and IPC |
| `platform.cjs`, `platform-text.js` | Platform differences: finding and starting tools, paths, the texts shown per OS |
| `i18n.js`, `locales.cjs`, `locales/*.json` | Interface languages (zh-Hant source, zh-Hans, en, ja): `t()` in pages and the main process, `data-i18n*` attributes in HTML; `scripts/i18n-lint.cjs` keeps hard-coded text out |
| `renderer.js` | Companion UI |
| `avatars.js` | Character rendering: SVG / PNG / VRM / glTF / Live2D / MMD |
| `mods.cjs`, `mod-assets.cjs` | Mod validation |
| `person-service.cjs`, `person-draw.cjs` | Drawing characters with Codex |
| `asset-library.cjs`, `assisted.cjs`, `archive.cjs`, `model-formats.cjs` | Avatar store, assisted download, model import |
| `voices.cjs`, `voice-engines/`, `voice-service.cjs`, `voice-lab.*` | Voices and voice cloning |
| `speech.cjs`, `wake-service.cjs` | Voice output, wake word and dictation |
| `local-llm.cjs`, `cli-setup.cjs` | Built-in model; Codex / Claude setup |
| `remote-server.cjs`, `remote/` | Phone remote |
| `dev-sessions.cjs`, `dev-session.cjs`, `dev-companion.cjs`, `dev-speech.cjs`, `permission-mcp.cjs` | 開發夥伴: session discovery, Claude Code / Codex adapters, the permission prompt tool |

## Privacy

- **On the Mac only:**
  - built-in model, Kokoro, VOICEVOX, CosyVoice, GPT-SoVITS;
  - wake word and dictation;
  - photos and recordings used to draw characters or clone voices. They are deleted afterwards, except the short reference clip a cloned voice needs.
- **Codex / Claude:** your messages and the photos you choose to draw go to OpenAI or Anthropic through their official CLIs.
- **Edge / OpenAI / ElevenLabs voices:** the reply text goes to Microsoft, OpenAI or ElevenLabs.
- **API keys and tokens** are stored encrypted (macOS Keychain, Windows DPAPI, the Linux Secret Service keyring) and are only sent to their own service.

Settings, conversation history, your characters, voices and downloaded models live in the app's userData folder.

## License

- **Source code:** [Apache License 2.0](LICENSE).
- **Original characters and artwork** (Annie, Miso, Byte, Pixel Byte, the app icon): [CC BY 4.0](LICENSE-ASSETS). Credit "Agent Wardrobe contributors".
- **Blocky** (the sample VRM): CC0.
- **Third-party components and models:** their own licences, listed in [THIRD_PARTY.md](THIRD_PARTY.md). Please read [Before you distribute this app](THIRD_PARTY.md#before-you-distribute-this-app) if you ship a build, in particular Live2D's SDK release licence.

"Agent Wardrobe" and the Annie character are not licensed as trademarks (Apache-2.0 §6).
