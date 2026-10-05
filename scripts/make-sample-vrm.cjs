// Builds "Blocky", the bundled sample VRM, from code: a low-poly box character made for this project and released under CC0.
// Every humanoid bone carries its own rigid box meshes (no skinning), and the face is one mesh whose morph targets
// drive the VRM expressions (blink, happy, aa, ...). The output is deterministic, so the committed file can be checked.
// Usage: node scripts/make-sample-vrm.cjs [out.vrm]   (default: mods/vrm-sample/sample.vrm)
const fs = require('node:fs');
const path = require('node:path');

// --- colours (linear-ish RGB for glTF baseColorFactor)
const COLOURS = {
  skin: [0.96, 0.78, 0.64], hair: [0.32, 0.20, 0.13], shirt: [0.16, 0.62, 0.60], trim: [0.98, 0.80, 0.30],
  pants: [0.16, 0.22, 0.42], shoe: [0.12, 0.12, 0.14], ink: [0.08, 0.07, 0.07], cheek: [0.95, 0.52, 0.55]
};

// --- humanoid skeleton: name, parent, translation from the parent (metres). VRM 1.0 rest pose: T-pose facing +Z, model's left is +X.
const BONES = [
  ['hips', null, [0, 0.78, 0]],
  ['spine', 'hips', [0, 0.08, 0]],
  ['chest', 'spine', [0, 0.14, 0]],
  ['neck', 'chest', [0, 0.17, 0]],
  ['head', 'neck', [0, 0.06, 0]],
  ['leftShoulder', 'chest', [0.05, 0.13, 0]],
  ['leftUpperArm', 'leftShoulder', [0.10, 0, 0]],
  ['leftLowerArm', 'leftUpperArm', [0.22, 0, 0]],
  ['leftHand', 'leftLowerArm', [0.20, 0, 0]],
  ['rightShoulder', 'chest', [-0.05, 0.13, 0]],
  ['rightUpperArm', 'rightShoulder', [-0.10, 0, 0]],
  ['rightLowerArm', 'rightUpperArm', [-0.22, 0, 0]],
  ['rightHand', 'rightLowerArm', [-0.20, 0, 0]],
  ['leftUpperLeg', 'hips', [0.09, -0.04, 0]],
  ['leftLowerLeg', 'leftUpperLeg', [0, -0.34, 0]],
  ['leftFoot', 'leftLowerLeg', [0, -0.34, 0]],
  ['rightUpperLeg', 'hips', [-0.09, -0.04, 0]],
  ['rightLowerLeg', 'rightUpperLeg', [0, -0.34, 0]],
  ['rightFoot', 'rightLowerLeg', [0, -0.34, 0]]
];

// --- boxes per bone, in the bone's local space: [centre, size, colour]
const mirror = list => list.map(([c, s, k]) => [[-c[0], c[1], c[2]], s, k]);
const ARM = { upper: [[[0.11, 0, 0], [0.22, 0.10, 0.10], 'shirt']], lower: [[[0.10, 0, 0], [0.20, 0.08, 0.08], 'skin']], hand: [[[0.05, 0, 0], [0.09, 0.09, 0.07], 'skin']] };
const LEG = { upper: [[[0, -0.17, 0], [0.13, 0.34, 0.14], 'pants']], lower: [[[0, -0.17, 0], [0.11, 0.34, 0.12], 'pants']], foot: [[[0, -0.025, 0.04], [0.12, 0.07, 0.22], 'shoe']] };
const BOXES = {
  hips: [[[0, 0.01, 0], [0.30, 0.14, 0.18], 'pants']],
  spine: [[[0, 0.07, 0], [0.30, 0.14, 0.17], 'shirt'], [[0, -0.005, 0], [0.31, 0.03, 0.18], 'trim']],
  chest: [[[0, 0.08, 0], [0.32, 0.18, 0.18], 'shirt']],
  neck: [[[0, 0.03, 0], [0.08, 0.07, 0.08], 'skin']],
  head: [
    [[0, 0.17, 0], [0.36, 0.34, 0.32], 'skin'],
    [[0, 0.355, -0.01], [0.39, 0.07, 0.35], 'hair'],     // top
    [[0, 0.20, -0.175], [0.39, 0.32, 0.04], 'hair'],     // back
    [[0.185, 0.24, -0.03], [0.03, 0.20, 0.28], 'hair'],  // sides
    [[-0.185, 0.24, -0.03], [0.03, 0.20, 0.28], 'hair'],
    [[0.06, 0.315, 0.165], [0.22, 0.05, 0.03], 'hair'],  // fringe
    [[0.125, 0.10, 0.162], [0.05, 0.03, 0.01], 'cheek'],
    [[-0.125, 0.10, 0.162], [0.05, 0.03, 0.01], 'cheek']
  ],
  leftUpperArm: ARM.upper, leftLowerArm: ARM.lower, leftHand: ARM.hand,
  rightUpperArm: mirror(ARM.upper), rightLowerArm: mirror(ARM.lower), rightHand: mirror(ARM.hand),
  leftUpperLeg: LEG.upper, leftLowerLeg: LEG.lower, leftFoot: LEG.foot,
  rightUpperLeg: LEG.upper, rightLowerLeg: LEG.lower, rightFoot: LEG.foot
};

// --- face (on the head bone): two eyes and a mouth whose morph targets make the expressions
const EYE = { y: 0.19, z: 0.168, w: 0.05, h: 0.075, d: 0.012, x: 0.075 };
const MOUTH = { y: 0.085, z: 0.168, w: 0.09, h: 0.022, d: 0.012 };
const FACE_PARTS = [
  { part: 'eyeL', centre: [EYE.x, EYE.y, EYE.z], size: [EYE.w, EYE.h, EYE.d] },
  { part: 'eyeR', centre: [-EYE.x, EYE.y, EYE.z], size: [EYE.w, EYE.h, EYE.d] },
  { part: 'mouth', centre: [0, MOUTH.y, MOUTH.z], size: [MOUTH.w, MOUTH.h, MOUTH.d] }
];
// each morph: part -> (vertex relative to its part centre) -> displacement
const squash = (k, lift = 0) => ([, y]) => [0, -y * k + lift, 0];
const MORPHS = [
  ['blink', { eyeL: squash(0.9), eyeR: squash(0.9) }],
  ['blinkLeft', { eyeL: squash(0.9) }],
  ['blinkRight', { eyeR: squash(0.9) }],
  ['happy', { eyeL: squash(0.75, 0.01), eyeR: squash(0.75, 0.01), mouth: ([x, y]) => [x * 0.5, y < 0 ? -0.02 : 0, 0] }],
  ['sad', { eyeL: squash(0.45, -0.008), eyeR: squash(0.45, -0.008), mouth: ([x, y]) => [-x * 0.3, y > 0 ? -0.004 : 0, 0] }],
  ['angry', { eyeL: squash(0.5), eyeR: squash(0.5), mouth: ([x]) => [-x * 0.2, 0, 0] }],
  ['relaxed', { eyeL: squash(0.6), eyeR: squash(0.6), mouth: ([x]) => [x * 0.2, 0, 0] }],
  ['surprised', { eyeL: ([x, y]) => [x * 0.3, y * 0.3, 0], eyeR: ([x, y]) => [x * 0.3, y * 0.3, 0], mouth: ([x, y]) => [-x * 0.4, y < 0 ? -0.045 : 0, 0] }],
  ['aa', { mouth: ([x, y]) => [-x * 0.15, y < 0 ? -0.05 : 0, 0] }],
  ['ih', { mouth: ([x, y]) => [x * 0.3, y < 0 ? -0.012 : 0, 0] }],
  ['ou', { mouth: ([x, y]) => [-x * 0.5, y < 0 ? -0.03 : 0, 0] }],
  ['ee', { mouth: ([x, y]) => [x * 0.4, y < 0 ? -0.02 : 0, 0] }],
  ['oh', { mouth: ([x, y]) => [-x * 0.35, y < 0 ? -0.04 : 0, 0] }]
];

// --- a box: 24 vertices (flat normals), 36 indices
const FACES = [
  [[1, 0, 0], [[1, -1, -1], [1, 1, -1], [1, 1, 1], [1, -1, 1]]],
  [[-1, 0, 0], [[-1, -1, 1], [-1, 1, 1], [-1, 1, -1], [-1, -1, -1]]],
  [[0, 1, 0], [[-1, 1, 1], [1, 1, 1], [1, 1, -1], [-1, 1, -1]]],
  [[0, -1, 0], [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]]],
  [[0, 0, 1], [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]]],
  [[0, 0, -1], [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]]]
];
function box(centre, size, out, tag) {
  for (const [normal, corners] of FACES) {
    const base = out.positions.length / 3;
    for (const corner of corners) {
      const local = corner.map((v, i) => v * size[i] / 2);
      out.positions.push(...local.map((v, i) => v + centre[i])); out.normals.push(...normal); out.local.push(local); out.tags.push(tag);
    }
    out.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
}

// --- glTF binary assembly
const round = v => Math.round(v * 1e6) / 1e6;
function build() {
  const gltf = {
    asset: { version: '2.0', generator: 'Agent Wardrobe make-sample-vrm.cjs' },
    extensionsUsed: ['VRMC_vrm'], scene: 0, scenes: [{ name: 'Blocky', nodes: [] }],
    nodes: [], meshes: [], materials: [], accessors: [], bufferViews: [], buffers: []
  };
  const chunks = []; let length = 0;
  const view = (buffer, target) => {
    const pad = (4 - (length % 4)) % 4; if (pad) { chunks.push(Buffer.alloc(pad)); length += pad; }
    gltf.bufferViews.push({ buffer: 0, byteOffset: length, byteLength: buffer.length, ...(target ? { target } : {}) });
    chunks.push(buffer); length += buffer.length; return gltf.bufferViews.length - 1;
  };
  const vec3 = values => {
    const data = Buffer.alloc(values.length * 4); values.forEach((v, i) => data.writeFloatLE(round(v), i * 4));
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < values.length; i += 3) for (let k = 0; k < 3; k++) { const v = Math.fround(round(values[i + k])); min[k] = Math.min(min[k], v); max[k] = Math.max(max[k], v); }
    gltf.accessors.push({ bufferView: view(data, 34962), componentType: 5126, count: values.length / 3, type: 'VEC3', min, max });
    return gltf.accessors.length - 1;
  };
  const indices = values => {
    const data = Buffer.alloc(values.length * 2); values.forEach((v, i) => data.writeUInt16LE(v, i * 2));
    gltf.accessors.push({ bufferView: view(data, 34963), componentType: 5123, count: values.length, type: 'SCALAR' });
    return gltf.accessors.length - 1;
  };
  const material = {};
  for (const [name, rgb] of Object.entries(COLOURS)) {
    material[name] = gltf.materials.length;
    gltf.materials.push({ name, pbrMetallicRoughness: { baseColorFactor: [...rgb, 1], metallicFactor: 0, roughnessFactor: 0.85 } });
  }
  const node = (spec, parent) => { gltf.nodes.push(spec); const i = gltf.nodes.length - 1; if (parent == null) gltf.scenes[0].nodes.push(i); else (gltf.nodes[parent].children ||= []).push(i); return i; };
  // a mesh with one primitive per colour, attached to the bone through a child node with no transform
  const meshNode = (name, boxes, parent) => {
    const byColour = new Map();
    for (const [centre, size, colour] of boxes) { if (!byColour.has(colour)) byColour.set(colour, { positions: [], normals: [], indices: [], local: [], tags: [] }); box(centre, size, byColour.get(colour)); }
    const primitives = [...byColour].map(([colour, g]) => ({ attributes: { POSITION: vec3(g.positions), NORMAL: vec3(g.normals) }, indices: indices(g.indices), material: material[colour] }));
    gltf.meshes.push({ name, primitives });
    return node({ name, mesh: gltf.meshes.length - 1 }, parent);
  };

  const root = node({ name: 'Blocky' }, null);
  const bone = {};
  for (const [name, parent, translation] of BONES) bone[name] = node({ name, translation }, parent ? bone[parent] : root);
  for (const [name, boxes] of Object.entries(BOXES)) meshNode(`${name}_mesh`, boxes, bone[name]);

  // face mesh with morph targets
  const face = { positions: [], normals: [], indices: [], local: [], tags: [] };
  for (const { part, centre, size } of FACE_PARTS) box(centre, size, face, part);
  const targets = MORPHS.map(([, rule]) => {
    const offsets = [];
    face.local.forEach((local, i) => offsets.push(...(rule[face.tags[i]] ? rule[face.tags[i]](local) : [0, 0, 0])));
    return { POSITION: vec3(offsets) };
  });
  gltf.meshes.push({
    name: 'face', extras: { targetNames: MORPHS.map(([name]) => name) },
    primitives: [{ attributes: { POSITION: vec3(face.positions), NORMAL: vec3(face.normals) }, indices: indices(face.indices), material: material.ink, targets }],
    weights: MORPHS.map(() => 0)
  });
  const faceNode = node({ name: 'face', mesh: gltf.meshes.length - 1 }, bone.head);

  const expression = index => ({ morphTargetBinds: [{ node: faceNode, index, weight: 1 }], isBinary: false, overrideBlink: 'none', overrideLookAt: 'none', overrideMouth: 'none' });
  gltf.extensions = {
    VRMC_vrm: {
      specVersion: '1.0',
      meta: {
        name: 'Blocky', version: '1.0', authors: ['Agent Wardrobe contributors'],
        copyrightInformation: 'Made from code by scripts/make-sample-vrm.cjs; dedicated to the public domain (CC0 1.0).',
        // VRM 1.0 fixes licenseUrl to the VRM Public License (three-vrm refuses any other value); the permissions below
        // grant everything it can, and otherLicenseUrl carries the actual dedication: CC0 1.0.
        licenseUrl: 'https://vrm.dev/licenses/1.0/', otherLicenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
        avatarPermission: 'everyone', allowExcessivelyViolentUsage: true, allowExcessivelySexualUsage: false,
        commercialUsage: 'corporation', allowPoliticalOrReligiousUsage: true, allowAntisocialOrHateUsage: false,
        creditNotation: 'unnecessary', allowRedistribution: true, modification: 'allowModificationRedistribution'
      },
      humanoid: { humanBones: Object.fromEntries(BONES.map(([name]) => [name, { node: bone[name] }])) },
      expressions: { preset: Object.fromEntries(MORPHS.map(([name], index) => [name, expression(index)])) },
      lookAt: { type: 'expression', offsetFromHeadBone: [0, 0.19, 0.1],
        rangeMapHorizontalInner: { inputMaxValue: 90, outputScale: 1 }, rangeMapHorizontalOuter: { inputMaxValue: 90, outputScale: 1 },
        rangeMapVerticalDown: { inputMaxValue: 90, outputScale: 1 }, rangeMapVerticalUp: { inputMaxValue: 90, outputScale: 1 } }
    }
  };

  const bin = Buffer.concat(chunks); const binPadded = Buffer.concat([bin, Buffer.alloc((4 - (bin.length % 4)) % 4)]);
  gltf.buffers.push({ byteLength: binPadded.length });
  let json = Buffer.from(JSON.stringify(gltf), 'utf8'); json = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 0x20)]);
  const header = Buffer.alloc(12); header.write('glTF', 0, 'latin1'); header.writeUInt32LE(2, 4); header.writeUInt32LE(12 + 8 + json.length + 8 + binPadded.length, 8);
  const chunkHeader = (len, type) => { const b = Buffer.alloc(8); b.writeUInt32LE(len, 0); b.write(type, 4, 'latin1'); return b; };
  return Buffer.concat([header, chunkHeader(json.length, 'JSON'), json, chunkHeader(binPadded.length, 'BIN\0'), binPadded]);
}

module.exports = { build, BONES, MORPHS };
if (require.main === module) {
  const out = path.resolve(process.argv[2] || path.join(__dirname, '..', 'mods', 'vrm-sample', 'sample.vrm'));
  const data = build(); fs.writeFileSync(out, data);
  console.log(`wrote ${path.relative(process.cwd(), out)} (${data.length} bytes)`);
}
