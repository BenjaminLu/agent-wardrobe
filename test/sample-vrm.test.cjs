const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
const {build}=require('../scripts/make-sample-vrm.cjs');const mods=require('../src/main/mods.cjs');
const FILE=path.join(__dirname,'..','mods','vrm-sample','sample.vrm');
const REQUIRED=['hips','spine','head','leftUpperArm','leftLowerArm','leftHand','rightUpperArm','rightLowerArm','rightHand','leftUpperLeg','leftLowerLeg','leftFoot','rightUpperLeg','rightLowerLeg','rightFoot'];
const json=data=>JSON.parse(data.subarray(20,20+data.readUInt32LE(12)).toString('utf8'));
test('the bundled Blocky VRM is exactly what scripts/make-sample-vrm.cjs builds',()=>{
  assert.ok(build().equals(fs.readFileSync(FILE)),'run `node scripts/make-sample-vrm.cjs` and commit the result');
});
test('Blocky is a VRM 1.0 humanoid with open, original metadata and face expressions',()=>{
  const data=fs.readFileSync(FILE);assert.equal(data.subarray(0,4).toString('latin1'),'glTF');assert.equal(data.readUInt32LE(8),data.length);
  const gltf=json(data),vrm=gltf.extensions.VRMC_vrm;assert.ok(gltf.extensionsUsed.includes('VRMC_vrm'));assert.equal(vrm.specVersion,'1.0');
  assert.deepEqual({name:vrm.meta.name,authors:vrm.meta.authors},{name:'Blocky',authors:['Agent Wardrobe contributors']});
  assert.equal(vrm.meta.otherLicenseUrl,'https://creativecommons.org/publicdomain/zero/1.0/');
  assert.equal(vrm.meta.licenseUrl,'https://vrm.dev/licenses/1.0/','VRM 1.0 requires this value; three-vrm refuses any other');
  assert.deepEqual([vrm.meta.allowRedistribution,vrm.meta.avatarPermission,vrm.meta.commercialUsage,vrm.meta.modification],[true,'everyone','corporation','allowModificationRedistribution']);
  for(const bone of REQUIRED)assert.ok(Number.isInteger(vrm.humanoid.humanBones[bone]?.node),bone);
  for(const name of ['happy','blink','aa','blinkLeft','sad','surprised','relaxed'])assert.ok(vrm.expressions.preset[name]?.morphTargetBinds.length,name);
  assert.ok(!gltf.images&&gltf.buffers.every(b=>!b.uri),'no textures and no external files');
  assert.deepEqual(mods.validate(JSON.parse(fs.readFileSync(path.join(FILE,'..','mod.json'),'utf8')),path.dirname(FILE)).license.models['sample.vrm'].redistribution,true);
});
test('three-vrm loads Blocky: humanoid, expressions on the face, arms relax downwards as avatars.js poses them',async()=>{
  const THREE=await import('three');const {GLTFLoader}=await import('three/examples/jsm/loaders/GLTFLoader.js');const {VRMLoaderPlugin}=await import('@pixiv/three-vrm');
  const data=fs.readFileSync(FILE),loader=new GLTFLoader();loader.register(parser=>new VRMLoaderPlugin(parser));
  const gltf=await new Promise((resolve,reject)=>loader.parse(data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength),'',resolve,reject));
  const vrm=gltf.userData.vrm;assert.ok(vrm,'loaded as a VRM');assert.equal(vrm.meta.metaVersion,'1');assert.equal(vrm.meta.name,'Blocky');
  for(const bone of REQUIRED)assert.ok(vrm.humanoid.getRawBoneNode(bone),bone);
  const world=name=>{vrm.update(0);vrm.scene.updateMatrixWorld(true);return vrm.humanoid.getRawBoneNode(name).getWorldPosition(new THREE.Vector3());};
  assert.ok(world('leftUpperArm').x>world('rightUpperArm').x,'faces +Z with the left arm on +X');
  for(const [name,z] of [['leftUpperArm',-1.15],['rightUpperArm',1.15]])vrm.humanoid.getNormalizedBoneNode(name).rotation.z=z;
  assert.ok(world('leftHand').y<world('leftUpperArm').y-.2,'the relaxed pose lowers the hands');
  let face;vrm.scene.traverse(o=>{if(o.isMesh&&o.morphTargetInfluences)face=o;});
  vrm.expressionManager.setValue('aa',1);vrm.expressionManager.setValue('happy',1);vrm.update(0);
  assert.ok(face.morphTargetInfluences.filter(v=>v===1).length>=2,'expressions move the face');
  const box=new THREE.Box3().setFromObject(vrm.scene);assert.ok(box.max.y-box.min.y>1.4&&box.max.y-box.min.y<1.8,'about 1.6 m tall');
});
