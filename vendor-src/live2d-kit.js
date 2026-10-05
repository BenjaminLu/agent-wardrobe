// Bundled into vendor/live2d-kit.js (npm run build:live2d): PixiJS 8 and a Live2D (Cubism 3-5) renderer.
// Live2D's own Cubism Core is not in here: it is downloaded once, with the user's consent, and loaded before this file.
import 'pixi.js/unsafe-eval';
import { Application, extensions, loadTextures } from 'pixi.js';
import { Live2DModel, Live2DPlugin } from 'untitled-pixi-live2d-engine/cubism';
extensions.add(Live2DPlugin);
// textures decode on the page: the pages' CSP has no worker-src for Pixi's blob: workers
loadTextures.config.preferWorkers = false;
window.Live2DKit = { Application, Live2DModel };
