# Store thumbnails

Preview images for the avatar store's featured VRoid samples (`asset-library.cjs`, `FEATURED`). Only models released under **CC0 1.0** have a bundled thumbnail. Every other featured entry shows 「預覽要下載後才看得到」 until the user downloads it.

| File | Shows | Source model | Licence |
| --- | --- | --- | --- |
| `Sendagaya_Shino.png` | 千駄ヶ谷 篠 Shino | VRoid β sample model by pixiv | CC0 1.0 |
| `Sendagaya_Shibu.png` | 千駄ヶ谷 渋 Shibu | VRoid β sample model by pixiv | CC0 1.0 |
| `Sakurada_Fumiriya.png` | 桜田 フミリヤ Fumiriya | VRoid β sample model by pixiv | CC0 1.0 |
| `Vita.png` | Vita | VRoid β sample model by pixiv | CC0 1.0 |
| `Vivi.png` | Vivi | VRoid β sample model by pixiv | CC0 1.0 |
| `Victoria_Rubin.png` | Victoria Rubin | VRoid β sample model by pixiv | CC0 1.0 |
| `Darkness_Shibu.png` | 闇の 渋 Darkness Shibu | VRoid β sample model by pixiv | CC0 1.0 |

pixiv dedicates these sample models to the public domain under CC0 1.0. Its announcement is at <https://vroid.pixiv.help/hc/en-us/articles/4402614652569>. The models themselves are not in this repository. The store downloads them on request from <https://github.com/madjin/vrm-samples> (`vroid/beta/`).

Each image is the model's own thumbnail, the one embedded in the `.vrm` metadata (VRM 0.x `meta.texture`), reduced to 256 × 256. It is part of the CC0 model and falls under the same dedication. For example, `Vita.vrm` declares `licenseName: "CC0"`, and its embedded thumbnail matches `Vita.png`.

Do not add thumbnails here for models under any other licence. The VRoid stable samples (AvatarSample A/B/C, under VRoid's own terms) and Seed-san (VRM Public License, by VirtualCast) were removed for that reason.
