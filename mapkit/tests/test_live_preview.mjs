import assert from 'node:assert/strict';
import test, { THREE } from './three.mjs';
import { createRotations } from '../editor/static/rotation.js';
import { createLiveBlocks } from '../editor/static/live-blocks.js';
import { createLiveLighting, nearestPreviewLights, LIVE_LIGHT_MAX } from '../editor/static/live-lighting.js';
const b = { name: 'Block', lo: [10, 20, 30], hi: [110, 220, 330], tex: 'Metal', rot: [0, 16384, 0] };
function proxy(box) {
  const p = new THREE.Mesh(); p.userData.box = box;
  p.position.set((box.lo[0]+box.hi[0])/2,(box.lo[2]+box.hi[2])/2,(box.lo[1]+box.hi[1])/2);
  p.scale.set(box.hi[0]-box.lo[0],box.hi[2]-box.lo[2],box.hi[1]-box.lo[1]);
  p.quaternion.copy(createRotations(THREE).quat(box.rot)); return p;
}
test('built pose is identity, a drag moves one copy before committing edits', () => {
  const live = createLiveBlocks(THREE, createRotations(THREE)), group = new THREE.Group(), p = proxy(b);
  live.add(b.name, structuredClone(b), group); live.sync([p]);
  group.matrix.elements.forEach((v,i) => assert.ok(Math.abs(v - new THREE.Matrix4().elements[i]) < 1e-8));
  p.position.x += 300; p.rotateX(0.3); p.scale.y *= 2; live.sync([p]);
  const originalCentre = new THREE.Vector3(60,180,120).applyMatrix4(group.matrix);
  assert.ok(originalCentre.distanceTo(p.position) < 1e-6); assert.equal(b.lo[0],10);
});
test('deletion and hidden blocks suppress baked faces; undo restores them', () => {
  const live = createLiveBlocks(THREE, createRotations(THREE)), group = new THREE.Group(), p = proxy(b);
  live.add(b.name,b,group); live.sync([]); assert.equal(group.visible,false);
  live.sync([p]); assert.equal(group.visible,true);
  p.visible=false; live.sync([p]); assert.equal(group.visible,false);
  p.visible=true; p.userData.box={...b,tex:'Other'}; live.sync([p]); assert.equal(group.visible,false);
  p.userData.box=b;live.sync([p]);assert.equal(group.visible,true);
});
test('edited geometry replaces baked faces instead of drawing twice', () => {
  const live = createLiveBlocks(THREE, createRotations(THREE)), group = new THREE.Group(); live.add(b.name,b,group);
  assert.equal(live.canFollow({...b,shape:'wedge'}),false);
  assert.equal(live.canFollow({...b,lo:[20,30,40]}),true);
});
test('drawn walls follow uncommitted movement and retain ownership after translation', () => {
  const live=createLiveBlocks(THREE,createRotations(THREE)),group=new THREE.Group(),p=new THREE.Group();
  const drawn={name:'Wall',kind:'wall',pts:[[0,0],[100,0]],z:10};
  p.userData.drawn=drawn;p.position.set(50,10,0);live.addDrawing(drawn.name,structuredClone(drawn),group);live.sync([p]);
  p.position.z+=200;live.sync([p]);assert.equal(group.matrix.elements[14],200);
  p.userData.drawn={...drawn,pts:[[0,200],[100,200]]};assert.equal(live.canFollowDrawing(p.userData.drawn),true);
  live.sync([p]);assert.equal(group.visible,true);
  p.userData.drawn={...drawn,pts:[[0,200],[150,200]]};live.sync([p]);assert.equal(group.visible,false);
});
test('light budget is bounded and selected distant light stays responsive', () => {
  const lights=Array.from({length:70},(_,i)=>({id:String(i),L:[i*100,0,0,1,0,0,100,0,1,0,0,64],selected:i===69}));
  const near=nearestPreviewLights(lights,[0,0,0]); assert.equal(near.length,LIVE_LIGHT_MAX); assert.equal(near[0].id,'69');
  assert.equal(nearestPreviewLights([{id:'off',L:[0,0,0,0,0,0,100]}],[0,0,0]).length,0);
});
test('uniforms follow moves, hue, range, spotlight direction and deletion', () => {
  const live=createLiveLighting(THREE);
  const lamp={id:'Light',L:[10,20,30,1,0,0,500,12,0,1,0,64]};
  live.update([lamp],[0,0,0]); assert.deepEqual(live.uniforms.uLivePos.value[0].toArray(),[10,30,20,500]);
  lamp.L=[80,90,100,0,0,1,200,13,1,0,0,64];live.update([lamp],[0,0,0],1.5);
  assert.deepEqual(live.uniforms.uLiveCol.value[0].toArray(),[0,0,1,1]);assert.equal(live.uniforms.uLiveGain.value,1.5);
  live.update([],[0,0,0]);assert.equal(live.uniforms.uLiveN.value,0);
});


