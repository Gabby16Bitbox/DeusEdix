import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildUVIslands, continuousUVHits, textureUVToPoint, triangleCanvasPolygons } from './texture-paint-uv.js';

// makeObject(texture) returns the real selected mesh with only the edited slot
// wearing texture. Mark the returned root.userData.texturePaintOwned=true only
// when every geometry/material was cloned: shared map resources stay untouched.
export function createTexturePaint3D(canvas, options) {
  const { makeObject, getCanvas, getBrushSize = () => 16 } = options;
  const texture = new THREE.CanvasTexture(getCanvas());
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.flipY = false;
  const object = makeObject(texture);
  if (!object) { texture.dispose(); return null; }
  if (texture.matrixAutoUpdate) texture.updateMatrix();
  const uvOptions = { wrapS: texture.wrapS, wrapT: texture.wrapT, flipY: texture.flipY, matrix: texture.matrix };
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.setClearColor(0x171c24);
  const scene = new THREE.Scene();
  scene.add(object, new THREE.HemisphereLight(0xffffff, 0x606070, 2));
  const key = new THREE.DirectionalLight(0xffffff, 1.7);
  key.position.set(1, 2, 3); scene.add(key);
  object.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(object), center = bounds.getCenter(new THREE.Vector3());
  const extent = bounds.getSize(new THREE.Vector3()), diameter = Math.max(extent.length(), .01);
  const camera = new THREE.PerspectiveCamera(40, 1, diameter / 1000, diameter * 100);
  const raycaster = new THREE.Raycaster(), pointer = new THREE.Vector2();
  const allMeshes = [], records = new Map(), materialList = mesh => Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  const ownedMaterials = new Set(), ownedGeometry = new Set(), wires = [];
  const ownsObject = object.userData.texturePaintOwned === true;
  const getVertex = (mesh, index) => mesh.getVertexPosition(index, new THREE.Vector3()).toArray();
  object.traverse(mesh => {
    if (!mesh.isMesh) return;
    allMeshes.push(mesh);
    if (ownsObject) ownedGeometry.add(mesh.geometry);
    for (const material of materialList(mesh)) if (ownsObject || material.map === texture) ownedMaterials.add(material);
    const geometry = mesh.geometry, uvs = geometry.attributes.uv;
    if (!uvs || !materialList(mesh).some(material => material.map === texture)) return;
    const triangles = [], count = geometry.index?.count ?? geometry.attributes.position.count;
    for (let offset = 0; offset + 2 < count; offset += 3) {
      if (offset < geometry.drawRange.start || offset >= geometry.drawRange.start + geometry.drawRange.count) continue;
      const group = geometry.groups.find(g => offset >= g.start && offset < g.start + g.count);
      const material = Array.isArray(mesh.material) ? mesh.material[group?.materialIndex ?? 0] : mesh.material;
      if (material?.map !== texture) continue;
      const indices = [0, 1, 2].map(i => geometry.index ? geometry.index.getX(offset + i) : offset + i);
      const triUV = indices.map(i => [uvs.getX(i), uvs.getY(i)]);
      const area = (triUV[1][0] - triUV[0][0]) * (triUV[2][1] - triUV[0][1]) - (triUV[1][1] - triUV[0][1]) * (triUV[2][0] - triUV[0][0]);
      if (!Number.isFinite(area) || Math.abs(area) < 1e-10) continue;
      triangles.push({ faceIndex: offset / 3, indices, positions: indices.map(i => getVertex(mesh, i)), uvs: triUV });
    }
    const topology = buildUVIslands(triangles), faceMap = new Map(triangles.map(triangle => [triangle.faceIndex, triangle]));
    const polygons = new Map();
    for (const [id, faces] of topology.islands) polygons.set(id, faces.flatMap(face => triangleCanvasPolygons(face.uvs, uvOptions)));
    records.set(mesh.uuid, { mesh, ...topology, faceMap, polygons });
    const vertices = [];
    for (const face of triangles) for (let i = 0; i < 3; i++) vertices.push(...face.positions[i], ...face.positions[(i + 1) % 3]);
    const wireGeometry = new THREE.BufferGeometry();
    wireGeometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    const wireMaterial = new THREE.LineBasicMaterial({ color: 0x76d4ff, transparent: true, opacity: .5, depthTest: true, depthWrite: false });
    const wire = new THREE.LineSegments(wireGeometry, wireMaterial);
    wire.visible = false; wire.renderOrder = 2; mesh.add(wire);
    wires.push(wire);
  });

  // A texture-space circle projected into the hit triangle's tangent plane.
  // Its ellipse shows the brush's actual texel footprint on stretched UVs.
  const cursorGeometry = new THREE.BufferGeometry();
  cursorGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(65 * 3), 3));
  const cursorMaterial = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: .95, depthTest: false, depthWrite: false });
  const cursor = new THREE.Line(cursorGeometry, cursorMaterial);
  cursor.renderOrder = 100; cursor.visible = false; cursor.frustumCulled = false; scene.add(cursor);
  let paintingEnabled = options.paintingEnabled !== false, pointerId = null, previousHit = null, previousScreen = null;
  let stopped = false, raf = 0, hover = null, blockedSurface = null, orbit;
  const visible = mesh => { for (let part = mesh; part; part = part.parent) if (!part.visible) return false; return true; };
  function hitAt(clientX, clientY) {
    blockedSurface = null;
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    pointer.set((clientX - rect.left) / rect.width * 2 - 1, -(clientY - rect.top) / rect.height * 2 + 1);
    object.updateMatrixWorld(true); camera.updateMatrixWorld();
    raycaster.setFromCamera(pointer, camera);
    // The first surface blocks paint, even if it belongs to another skin slot.
    const intersection = raycaster.intersectObjects(allMeshes.filter(visible), false).find(hit => {
      const material = Array.isArray(hit.object.material) ? hit.object.material[hit.face.materialIndex] : hit.object.material;
      return material?.visible !== false;
    });
    if (!intersection) return null;
    const record = records.get(intersection.object.uuid), faceIndex = intersection.faceIndex;
    const material = Array.isArray(intersection.object.material) ? intersection.object.material[intersection.face.materialIndex] : intersection.object.material;
    if (material?.map !== texture || !intersection.uv || !record?.byFace.has(faceIndex)) {
      blockedSurface = { tex: intersection.object.userData.tex, slot: intersection.object.userData.slot,
        reason: material?.map !== texture ? 'material' : 'uv' };
      return null;
    }
    const doc = getCanvas(), mapped = textureUVToPoint(intersection.uv, doc.width, doc.height, uvOptions);
    if (!mapped) return null;
    return { ...mapped, uv: intersection.uv.clone(), point: intersection.point.clone(), faceIndex,
      islandId: record.byFace.get(faceIndex), objectId: intersection.object.uuid,
      adjacentFaces: record.adjacent.get(faceIndex), continuous: false };
  }
  function showHover(hit, notify = true) {
    hover = hit;
    if (notify) options.onHover?.(hit, hit ? null : blockedSurface);
    cursor.visible = !!hit && paintingEnabled;
    canvas.style.cursor = paintingEnabled ? hit ? 'crosshair' : 'not-allowed' : 'grab';
    if (!cursor.visible) return;
    const record = records.get(hit.objectId), face = record.faceMap.get(hit.faceIndex), doc = getCanvas();
    const [a, b, c] = face.positions.map(p => new THREE.Vector3(...p).applyMatrix4(record.mesh.matrixWorld));
    const e1 = b.clone().sub(a), e2 = c.clone().sub(a), uvs = face.uvs;
    const du1 = uvs[1][0] - uvs[0][0], dv1 = uvs[1][1] - uvs[0][1], du2 = uvs[2][0] - uvs[0][0], dv2 = uvs[2][1] - uvs[0][1];
    const determinant = du1 * dv2 - du2 * dv1;
    const tangentU = e1.clone().multiplyScalar(dv2).addScaledVector(e2, -dv1).divideScalar(determinant);
    const tangentV = e2.clone().multiplyScalar(du1).addScaledVector(e1, -du2).divideScalar(determinant);
    const m = texture.matrix.elements, md = m[0] * m[4] - m[3] * m[1];
    if (Math.abs(md) < 1e-12) { cursor.visible = false; return; }
    const radius = Math.max(1, getBrushSize()) / 2, positions = cursorGeometry.attributes.position;
    for (let i = 0; i <= 64; i++) {
      const angle = i / 64 * Math.PI * 2, tx = Math.cos(angle) * radius / doc.width, ty = Math.sin(angle) * radius / doc.height;
      const u = (m[4] * tx - m[3] * ty) / md, v = (-m[1] * tx + m[0] * ty) / md;
      const p = hit.point.clone().addScaledVector(tangentU, u).addScaledVector(tangentV, v);
      positions.setXYZ(i, p.x, p.y, p.z);
    }
    positions.needsUpdate = true;
  }
  const consume = event => { event.preventDefault(); event.stopImmediatePropagation(); };
  function onDown(event) {
    if (event.button !== 0 || !paintingEnabled) return;
    consume(event);
    const hit = hitAt(event.clientX, event.clientY);
    showHover(hit);
    if (!hit) return;
    // Returning false handles one-shot tools (picker/fill/text) without leaving
    // an active brush gesture behind.
    if (options.onStrokeStart?.(hit, event) === false || stopped || !paintingEnabled) return;
    pointerId = event.pointerId; previousHit = hit; previousScreen = [event.clientX, event.clientY];
    canvas.setPointerCapture(pointerId);
  }
  function onMove(event) {
    if (pointerId === null) {
      if (!event.buttons) showHover(paintingEnabled ? hitAt(event.clientX, event.clientY) : null);
      return;
    }
    if (event.pointerId !== pointerId) return;
    consume(event);
    const events = event.getCoalescedEvents?.() || [event];
    for (const sample of events.length ? events : [event]) {
      const start = previousScreen || [sample.clientX, sample.clientY];
      const count = Math.min(256, Math.max(1, Math.ceil(Math.hypot(sample.clientX - start[0], sample.clientY - start[1]) / 3)));
      for (let i = 1; i <= count; i++) {
        const hit = hitAt(start[0] + (sample.clientX - start[0]) * i / count, start[1] + (sample.clientY - start[1]) * i / count);
        if (hit) {
          const doc = getCanvas();
          hit.continuous = continuousUVHits(previousHit, hit, { width: doc.width, height: doc.height, brushSize: getBrushSize() });
          options.onStrokeMove?.(hit, event);
        }
        previousHit = hit;
      }
      previousScreen = [sample.clientX, sample.clientY];
    }
    showHover(previousHit);
  }
  function endPointer(event) {
    if (pointerId === null || (event.pointerId !== undefined && event.pointerId !== pointerId)) return;
    const id = pointerId; pointerId = null; previousHit = null; previousScreen = null;
    if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
    options.onStrokeEnd?.(event);
  }
  function onLeave() { if (pointerId === null) { blockedSurface = null; showHover(null); } }
  const onContext = event => event.preventDefault();
  const listeners = [['pointerdown', onDown], ['pointermove', onMove], ['pointerup', endPointer],
    ['pointercancel', endPointer], ['lostpointercapture', endPointer], ['pointerleave', onLeave], ['contextmenu', onContext]];
  for (const [name, listener] of listeners) canvas.addEventListener(name, listener);
  window.addEventListener('blur', endPointer);
  // Install OrbitControls after our handlers: painting consumes LMB first;
  // MMB and RMB continue to the normal camera controls without synthetic input.
  orbit = new OrbitControls(camera, canvas);
  orbit.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE };
  orbit.enableDamping = true; orbit.dampingFactor = .14;
  orbit.minDistance = diameter * .025; orbit.maxDistance = diameter * 12;
  orbit.addEventListener('start', () => { hover = null; blockedSurface = null; cursor.visible = false; options.onHover?.(null, null); });
  function resize() {
    if (stopped) return;
    const rect = canvas.getBoundingClientRect(), width = Math.max(1, Math.round(rect.width)), height = Math.max(1, Math.round(rect.height));
    renderer.setSize(width, height, false); camera.aspect = width / height; camera.updateProjectionMatrix();
  }
  function fit() {
    resize();
    const vertical = THREE.MathUtils.degToRad(camera.fov / 2), horizontal = Math.atan(Math.tan(vertical) * camera.aspect);
    const distance = diameter * .55 / Math.sin(Math.min(vertical, horizontal));
    camera.position.copy(center).add(new THREE.Vector3(.9, .35, .9).normalize().multiplyScalar(distance));
    orbit.target.copy(center); orbit.update();
  }
  const observer = new ResizeObserver(resize); observer.observe(canvas);
  fit();
  function loop() {
    if (stopped) return;
    raf = requestAnimationFrame(loop);
    if (!canvas.isConnected || !canvas.getClientRects().length) return;
    orbit.update(); renderer.render(scene, camera);
  }
  loop();
  return {
    update() { if (stopped) return; texture.image = getCanvas(); texture.needsUpdate = true; if (hover) showHover(hover, false); },
    resize, fit,
    setPaintingEnabled(enabled) { if (!enabled) endPointer({ type: 'modechange' }); paintingEnabled = !!enabled; blockedSurface = null; showHover(null); },
    setWireframe(enabled) { for (const wire of wires) wire.visible = !!enabled; },
    getIslandTriangles(hit) { return records.get(hit?.objectId)?.polygons.get(hit?.islandId) || []; },
    getUVWireframe() {
      const segments = [];
      for (const record of records.values()) for (const polygons of record.polygons.values()) for (const points of polygons) {
        for (let i = 0; i < points.length; i++) segments.push([...points[i], ...points[(i + 1) % points.length]]);
      }
      return segments;
    },
    getInfo() { return { meshes: records.size, triangles: [...records.values()].reduce((sum, record) => sum + record.faceMap.size, 0),
      islands: [...records.values()].reduce((sum, record) => sum + record.islands.size, 0), sharedUVsPossible: true }; },
    stop() {
      if (stopped) return;
      endPointer({ type: 'close' }); stopped = true; cancelAnimationFrame(raf); observer.disconnect();
      for (const [name, listener] of listeners) canvas.removeEventListener(name, listener);
      window.removeEventListener('blur', endPointer); orbit.dispose();
      for (const wire of wires) { wire.removeFromParent(); wire.geometry.dispose(); wire.material.dispose(); }
      cursorGeometry.dispose(); cursorMaterial.dispose();
      for (const geometry of ownedGeometry) geometry.dispose();
      for (const material of ownedMaterials) material.dispose();
      texture.dispose(); renderer.dispose();
    },
  };
}
