/* Blender-style viewport navigation, scoped to Animation Studio. */
import * as THREE from 'three';

export function createStudioNavigation(canvas, orbit, getCamera, replaceCamera, getHeight, frameAll, frameSelected) {
  let fly = null, hovering = false;
  const held = new Set();
  orbit.enableDamping = false; // A direct view/frame command must not inherit an old orbit's momentum.
  orbit.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.ROTATE, RIGHT: null };
  canvas.tabIndex = 0;
  canvas.title = 'MMB orbit · Shift+MMB pan · Ctrl+MMB / wheel zoom · Numpad views · Home frame all · Numpad . frame selected · Shift+` walk';
  canvas.addEventListener('pointerenter', () => { hovering = true; });
  canvas.addEventListener('pointerleave', () => { hovering = false; });
  canvas.addEventListener('pointerdown', e => {
    canvas.focus({ preventScroll: true });
    if (fly) { e.preventDefault(); e.stopImmediatePropagation(); stop(e.button === 2); return; }
    if (e.button === 1) orbit.mouseButtons.MIDDLE = e.ctrlKey ? THREE.MOUSE.DOLLY : THREE.MOUSE.ROTATE;
  }, true);
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  document.addEventListener('pointerlockchange', () => { if (fly && document.pointerLockElement !== canvas) stop(false); });
  document.addEventListener('mousemove', e => {
    if (!fly || document.pointerLockElement !== canvas) return;
    const c = getCamera(), rot = new THREE.Euler().setFromQuaternion(c.quaternion, 'YXZ');
    rot.y -= e.movementX * .002; rot.x = THREE.MathUtils.clamp(rot.x - e.movementY * .002, -1.55, 1.55);
    c.quaternion.setFromEuler(rot);
  });
  window.addEventListener('keyup', e => held.delete(e.code), true);
  window.addEventListener('blur', () => stop(false));

  function projection(ortho) {
    const old = getCamera();
    if (!!old.isOrthographicCamera === ortho) return;
    const aspect = canvas.clientWidth / Math.max(1, canvas.clientHeight);
    const distance = old.position.distanceTo(orbit.target), span = distance * Math.tan(20 * Math.PI / 180);
    const c = ortho ? new THREE.OrthographicCamera(-span * aspect, span * aspect, span, -span, .1, 5000)
      : new THREE.PerspectiveCamera(40, aspect, 1, 5000);
    c.position.copy(old.position); c.quaternion.copy(old.quaternion);
    if (!ortho) { const d = (old.top - old.bottom) / (2 * old.zoom * Math.tan(20 * Math.PI / 180));
      c.position.copy(orbit.target).add(old.position.clone().sub(orbit.target).setLength(d)); }
    replaceCamera(c); orbit.object = c; orbit.update();
  }
  function resize() {
    const c = getCamera(), aspect = canvas.clientWidth / Math.max(1, canvas.clientHeight);
    if (c.isOrthographicCamera) { const span = (c.top - c.bottom) / 2; c.left = -span * aspect; c.right = span * aspect; }
    else c.aspect = aspect;
    c.updateProjectionMatrix();
  }
  function frameOrtho(distance) {
    const c = getCamera();
    if (c.isOrthographicCamera) {
      const span = distance * Math.tan(20 * Math.PI / 180);
      c.top = span; c.bottom = -span; c.zoom = 1; resize();
    }
    orbit.update();
  }
  function step(code, pan) {
    const c = getCamera(), off = c.position.clone().sub(orbit.target);
    const horizontal = code === 'Numpad4' || code === 'Numpad6', sign = ['Numpad4', 'Numpad8'].includes(code) ? 1 : -1;
    if (pan) {
      const v = new THREE.Vector3(horizontal ? -sign : 0, horizontal ? 0 : sign, 0).applyQuaternion(c.quaternion).multiplyScalar(off.length() * .1);
      c.position.add(v); orbit.target.add(v);
    } else {
      const spherical = new THREE.Spherical().setFromVector3(off);
      if (horizontal) spherical.theta += sign * Math.PI / 12; else spherical.phi -= sign * Math.PI / 12;
      spherical.makeSafe(); c.position.copy(orbit.target).add(new THREE.Vector3().setFromSpherical(spherical));
    }
    orbit.update();
  }
  function stop(cancel) {
    if (!fly) return;
    const start = fly; fly = null; held.clear();
    const c = getCamera();
    if (cancel) { c.position.copy(start.position); c.quaternion.copy(start.quaternion); orbit.target.copy(start.target); }
    else orbit.target.copy(c.position).add(c.getWorldDirection(new THREE.Vector3()).multiplyScalar(start.distance));
    orbit.enabled = true; orbit.update();
    if (document.pointerLockElement === canvas) document.exitPointerLock();
  }
  async function start() {
    projection(false);
    const c = getCamera();
    fly = { position:c.position.clone(), quaternion:c.quaternion.clone(), target:orbit.target.clone(), distance:c.position.distanceTo(orbit.target) };
    orbit.enabled = false;
    try { await canvas.requestPointerLock(); } catch { stop(true); }
  }
  function key(e, viewFrom) {
    if (fly) {
      if (e.code === 'Escape') stop(true);
      else if (e.code === 'Enter' || e.code === 'Space') stop(false);
      else held.add(e.code);
      return true;
    }
    if (e.altKey) return false;
    if (e.shiftKey && e.code === 'Backquote' && (hovering || document.activeElement === canvas)) { void start(); return true; }
    const opposite = e.ctrlKey;
    const views = { Numpad1:opposite ? 'back' : 'front', Numpad3:opposite ? 'left' : 'right', Numpad7:opposite ? 'bottom' : 'top' };
    if (views[e.code]) { projection(true); viewFrom(views[e.code]); orbit.update(); return true; }
    if (e.code === 'Numpad5') { projection(!getCamera().isOrthographicCamera); return true; }
    if (e.code === 'Numpad9') { const c=getCamera(); c.position.copy(orbit.target).multiplyScalar(2).sub(c.position); orbit.update(); return true; }
    if (['Numpad2','Numpad4','Numpad6','Numpad8'].includes(e.code)) { step(e.code, opposite); return true; }
    if (['NumpadAdd','NumpadSubtract'].includes(e.code)) {
      const c=getCamera(), factor=e.code === 'NumpadAdd' ? .8 : 1.25;
      if (c.isOrthographicCamera) { c.zoom=THREE.MathUtils.clamp(c.zoom/factor,.02,100); c.updateProjectionMatrix(); }
      else c.position.sub(orbit.target).multiplyScalar(factor).add(orbit.target);
      orbit.update(); return true;
    }
    if (e.code === 'NumpadDecimal') { frameSelected(); return true; }
    if (e.code === 'Home' && (hovering || document.activeElement === canvas)) { frameAll(); return true; }
    return false;
  }
  function update(dt) {
    if (!fly) return;
    const c=getCamera(), v=new THREE.Vector3((held.has('KeyD')?1:0)-(held.has('KeyA')?1:0),0,(held.has('KeyS')?1:0)-(held.has('KeyW')?1:0));
    v.applyQuaternion(c.quaternion); v.y += (held.has('KeyE')?1:0)-(held.has('KeyQ')?1:0);
    if (v.lengthSq()) c.position.addScaledVector(v.normalize(), getHeight()*dt*(held.has('ShiftLeft') || held.has('ShiftRight') ? 3 : 1));
  }
  return { key, resize, frameOrtho, update, stop, get flying() { return !!fly; } };
}
