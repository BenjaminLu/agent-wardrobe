# Making a Mod

A Mod is one folder in `mods/<id>/` with a `mod.json` and the files it ships. These renderers are supported; pick the one that fits how you draw.

| Renderer | You provide | Expressions and interactions |
| --- | --- | --- |
| `svg` | `parts.json` with SVG shape markup | Full: blink, talk, emotions, wink, love eyes, eyes follow the cursor, poke reactions, palette recolours per skin |
| `png` | Transparent PNG/WebP layers + `parts.json` with their positions | Same as SVG for every layer you provide; skins are separate body images |
| `vrm` | A `.vrm` model (VRM 0.x or 1.0) | Mapped onto VRM expressions: `happy`, `sad`, `surprised`, `relaxed`, `aa` (talking), `blink`, `blinkLeft` (wink), look-at follows the cursor |
| `gltf` | A self-contained `.glb` | Shown as a statue that sways; its own animation clips play (an idle-named one loops, the others on pokes) |
| `live2d` | A Cubism 3–5 model folder (`*.model3.json`, `.moc3`, textures, motions) | `ParamMouthOpenY` (talking), eye blink, `ParamAngleX/Y` and eye balls follow the cursor, expressions by name (smile, sad, …), the `Idle` motion group loops, `TapBody` (or the skin's react motions) on pokes and success. Needs Live2D's own Cubism Core, which the app downloads from Live2D after the user agrees |
| `mmd` | A `.pmx` model with its textures | Morphs `まばたき` (blink), `あ` (talking), `笑い` / `にっこり` (happy), `困る`, `びっくり`; `.vmd` motions (an idle-named one loops) |

Working examples: `mods/annie` (svg), `mods/pixel-byte` (png), `mods/vrm-sample` (vrm: Blocky, built from code by `scripts/make-sample-vrm.cjs`). The built-in Miso and Byte use the older `schemaVersion: 1` code-drawn rigs and are not a template for new Mods.

## mod.json

```json
{
  "schemaVersion": 2,
  "id": "my-mod",                    // lowercase, matches the folder name
  "name": "My Mod",
  "description": "One line shown in the marketplace.",
  "author": "You",
  "license": "CC0 | CC BY 4.0 | CC BY-SA 4.0 | MIT | Apache-2.0 | VRM Public License …",
  "source": "https://where-the-artwork-comes-from (optional when you made it)",
  "identity": "Who the character is; becomes part of the chat prompt.",
  "renderer": "svg | png | vrm | gltf | live2d | mmd",
  "parts": "parts.json",             // svg and png only
  "defaultSkin": "everyday",
  "defaultPersona": "buddy",
  "skins": [ { "id": "everyday", "name": "Everyday", "states": { ... } } ],
  "personas": [ { "id": "buddy", "name": "Buddy", "prompt": "Be warm and concise." } ]
}
```

Every skin needs `states`, mapping each app activity to an emotion:

```json
"states": { "idle": "neutral", "working": "smug", "waiting_for_approval": "surprised",
            "speaking": "neutral", "success": "happy", "error": "nervous" }
```

Emotions are `neutral`, `smug`, `happy`, `surprised`, `nervous`, `sad`. Unknown fields are rejected.

Skin fields per renderer:

- `svg`: `palette` (six hex colours: `body`, `bodyLight`, `belly`, `accent`, `ink`, `cheek`) and `accessory` (an outfit key from `parts.json`).
- `png`: `image`, the full-body layer for this skin.
- `vrm`: `model`, the `.vrm` file for this skin. `gltf`: `model`, the `.glb` file.
- `live2d` / `mmd`: `model`, the path of the `.model3.json` / `.pmx` inside the Mod folder (for example `hiyori/hiyori.model3.json`). Paths are relative with `/`; no `..`, hidden parts or links. Every file in the folder must be a known type (json, moc3, png, jpg, webp, gif, tga, bmp, spa, sph, toon, pmx, vmd, vrma, txt) and all of them together at most 60 MB (150 MB for your own private characters). Texture names inside a PMX match regardless of case and slash direction.
- `motions` (vrm, live2d, mmd; optional): `[{"file": "motions/idle.vmd", "name": "待機", "loop": true, "use": "idle"}]`. `use` is `idle` (loops), `react` (pokes, success) or `talk` (while speaking). Files: `.vrma` for vrm, `.vmd` for mmd, `.motion3.json` for live2d. While a motion plays, the app's own arm pose and sway step aside. `model-formats.cjs` builds these folders and lists from an unpacked download.

## The face contract (svg and png)

The app shows and hides parts by class name. Use these classes; any other class is rejected.

| Class | Shown when |
| --- | --- |
| `eyes` (containing `pupils`) | Normally. `pupils` moves up to ±6 / ±4 units to follow the cursor, so keep room inside the eye. |
| `blink` | Blinking, every few seconds |
| `joy-eyes` | Happy, and as a poke reaction |
| `wink` | Poke reaction (one eye open) |
| `love-eyes` | Double-poke reaction |
| `smile` | Normally |
| `open-mouth` | Talking (scaled vertically) and surprised |
| `sad-mouth` | Sad |
| `brows` | Smug |
| `sweat` | Nervous |
| `tears` | Sad |
| `cheeks` | Always; stronger on love |
| `hands`, `legs` | Body parts an outfit may recolour or hide |

Only `eyes` is required. A missing expression simply is not shown.

## svg: parts.json

```json
{
  "transform": "translate(170 298) scale(.95) translate(-170 -302)",   // optional, positions the whole character
  "shadowY": 297,                                                     // optional ground shadow height
  "mouth": [171, 180],                                                // optional talking pivot
  "rig":  "<path d='...' fill='url(#body-gradient)'/>...",             // body, drawn first
  "face": "<g class='eyes'>...</g>...",                               // features, drawn over the body
  "accessories": {
    "everyday": { "svg": "..." },
    "gloves":   { "svg": "...", "fills": { "hands": "#ffffff" } },  // recolour a class
    "gown":     { "svg": "...", "hide": ["legs"] }                  // hide a class
  }
}
```

The canvas is 340 × 300, the character standing near y = 280. The outer group sets `stroke` to the skin's `ink` colour and `stroke-width` 6.

Allowed elements: `g`, `path`, `circle`, `ellipse`, `rect`, `line`, `polyline`, `polygon`. Allowed attributes: geometry, `fill`, `stroke`, `stroke-width`, `stroke-opacity`, `fill-opacity`, `opacity`, `stroke-linecap`, `stroke-linejoin`, `transform`, `class`. Colours are hex values, `none`, named colours, `var(--body|bodyLight|belly|accent|ink|cheek)` or `url(#body-gradient)`. No scripts, styles, text, links, images, event handlers or external URLs.

## png: parts.json

```json
{
  "frame": [340, 300],
  "eyes":   { "open": {"src": "eyes-open.png", "x": 0, "y": 0, "w": 340, "h": 300},
              "closed": {...}, "joy": {...}, "wink": {...}, "love": {...} },
  "mouth":  { "smile": {...}, "open": {...}, "sad": {...} },
  "extras": { "sweat": {...}, "tears": {...}, "cheeks": {...} }
}
```

Each layer is drawn at `x, y` with size `w × h` in the frame. Exporting every layer at full frame size (as `pixel-byte` does) is the easiest way to keep them aligned. Use transparent PNG or WebP, at most 4 MB each; draw at 2× (680 × 600) for sharp Retina output. Only `eyes.open` is required.

## vrm

Viewers rotate 3D Mods by dragging or scrolling over the model and reset with a double-click. In the companion window ⌥-drag moves the window instead; a click still pokes the character.

Use a self-contained `.vrm` (textures embedded, no external URIs), at most 40 MB. The model's own licence metadata must allow redistribution; the app reads it and refuses models that do not. VRoid Studio exports work as they are. The app relaxes the arms from the T-pose and frames the upper body. In VRM 1.0, `meta.licenseUrl` must be `https://vrm.dev/licenses/1.0/`, because three-vrm refuses any other value. A Creative Commons or other licence goes in `meta.otherLicenseUrl`, as Blocky's does (`scripts/make-sample-vrm.cjs` is a small worked example of a VRM 1.0 file built from code).

## Checking a Mod

```sh
node scripts/check-mods.cjs mods/<id>      # the same check pull requests run
npm test                                   # includes manifest and asset validation
npm start -- --smoke-test --mods-smoke     # renders one svg, png and vrm Mod in the real window
```

`npm start` and the marketplace (⌘⇧S) show every Mod in `mods/`. A Mod that fails validation is skipped; the companion shows which Mod and why, and the others still load.

## Licensing

To submit a Mod, see [CONTRIBUTING.md](../CONTRIBUTING.md).


A Mod bundled in this repository must be original or openly licensed. `license` must name CC0, CC BY, CC BY-SA, MIT, Apache-2.0, or the VRM Public License with redistribution allowed. `author` (or `source`) must say who made it. `scripts/check-mods.cjs` refuses licence text that says "private", "prototype only", "fan", "non-commercial" or "not for public distribution".

Do not submit portraits of real people without their consent, or characters owned by someone else (VTubers, anime, film or game IP, brand mascots, fan outfits). Users fetch those themselves through the store, and they stay on that user's Mac under their own licences.
