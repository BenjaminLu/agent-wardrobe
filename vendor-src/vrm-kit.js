// Bundled into vendor/vrm-kit.js (npm run build:vrm) so pages need no import map or remote script.
// One three.js for VRM / glTF, VRM Animation (.vrma) and MMD (.pmx + .vmd, @moeru/three-mmd).
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';
import { VRMAnimationLoaderPlugin, createVRMAnimationClip } from '@pixiv/three-vrm-animation';
import { MMDLoader, VMDLoader, buildAnimation } from '@moeru/three-mmd';
window.VRMKit = { THREE, GLTFLoader, VRMLoaderPlugin, VRMUtils, VRMAnimationLoaderPlugin, createVRMAnimationClip, MMDLoader, VMDLoader, buildAnimation };
