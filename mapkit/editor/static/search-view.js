// The 3D view while the Hierarchy's search is on, as Unity's Scene view search: what does not match is dimmed, what
// matches stays bright, and its parts behind walls glow through them. Nothing of the objects or their materials
// (often shared) changes, and the matches are not drawn again (their pixels stay the usual picture's): after the
// usual picture the view marks in the stencil where the matches are seen, draws a veil everywhere else, then a glow
// where they are behind something, their icons again over the veil, and what must stay bright over it all (the
// gizmo, the selection's outline). Their layers are put on before each picture and taken off right after it.
const SOLID = 30, ICON = 31;           // layers nothing else uses: the matches' meshes and lines; their icons

// a round picture n x n: white, its alpha alphaAt(r) (0 to 1) at r from its middle in halves of its side; filter: how
// it is sampled drawn bigger or smaller (none: a DataTexture's own, nearest). View > Effects' coronas are one too
// (light-effects-view.js)
export function radialTexture(THREE, n, alphaAt, filter) {
  const data = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const r = Math.hypot(x - n / 2 + 0.5, y - n / 2 + 0.5) / (n / 2), i = (y * n + x) * 4;
    data.set([255, 255, 255, Math.round(255 * alphaAt(r))], i);
  }
  const t = new THREE.DataTexture(data, n, n);
  if (filter) t.magFilter = t.minFilter = filter;
  t.needsUpdate = true;
  return t;
}
// a soft round dot: the glow of an icon behind a wall
export function dotTexture(THREE) {
  return radialTexture(THREE, 32, (r) => Math.max(0, 1 - r) ** 1.5);
}

// renderer, scene, camera: the 3D view's; over(): what is drawn again over the veil (it must stay bright)
export function createSearchView(THREE, { renderer, scene, camera, over = () => [], glow = 0xffb040 }) {
  // stencil 1: a match is seen there. Drawn a little nearer than it is, so that a block on the walls the last
  // Rebuild made of it (the same faces) counts as seen
  const seenMark = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, side: THREE.DoubleSide,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -8,
    stencilWrite: true, stencilRef: 1, stencilFunc: THREE.AlwaysStencilFunc, stencilZPass: THREE.ReplaceStencilOp });
  const notSeen = { stencilWrite: true, stencilRef: 1, stencilFunc: THREE.NotEqualStencilFunc };       // keeps the stencil
  const veilCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 2), veilScene = new THREE.Scene();
  const veil = new THREE.Mesh(new THREE.PlaneGeometry(2, 2),
    new THREE.MeshBasicMaterial({ ...notSeen, transparent: true, opacity: 0.62, depthTest: false, depthWrite: false }));
  veil.position.z = -1;
  veil.frustumCulled = false;
  veilScene.add(veil);
  // behind what is nearer, where the match is not seen: never on its own faces
  const hidden = { ...notSeen, transparent: true, depthWrite: false, depthFunc: THREE.GreaterDepth };
  const meshGlow = new THREE.MeshBasicMaterial({ ...hidden, color: glow, opacity: 0.4, side: THREE.DoubleSide });
  const spriteGlow = new THREE.SpriteMaterial({ ...hidden, color: glow, map: dotTexture(THREE), opacity: 0.9 });
  const black = new THREE.Color(0);
  let roots = null;                    // what matches (objects, blocks, structures), null: no search

  // each picture: the layers on what is drawn of the matches
  function mark() {
    const marked = [];
    let solids = 0, icons = 0;
    const put = (o, layer) => {
      if (o.layers.isEnabled(layer)) return;
      o.layers.enable(layer);
      marked.push([o, layer]);
    };
    for (const r of roots) if (r.parent) r.traverseVisible((o) => {
      if (o.isSprite) { put(o, ICON); icons++; } else if (o.isMesh || o.isLine) { put(o, SOLID); solids++; }
    });
    return { marked, solids, icons };
  }
  // the scene again, on one layer, with one material for all (null: their own)
  function pass(layer, material) {
    camera.layers.set(layer);
    scene.overrideMaterial = material;
    renderer.render(scene, camera);
  }
  function render() {
    if (!roots) return;
    const kept = { autoClear: renderer.autoClear, background: scene.background, auto: scene.matrixWorldAutoUpdate,
      override: scene.overrideMaterial, mask: camera.layers.mask };
    const { marked, solids, icons } = mark();
    renderer.autoClear = false;
    try {
      // no background (it would clear the picture), the matrices as the picture left them
      scene.background = null;
      scene.matrixWorldAutoUpdate = false;
      renderer.clearStencil();
      if (solids) pass(SOLID, seenMark);
      veil.material.color.copy(kept.background?.isColor ? kept.background : black);
      renderer.render(veilScene, veilCamera);
      if (solids) pass(SOLID, meshGlow);
      if (icons) { pass(ICON, null); pass(ICON, spriteGlow); }
      scene.overrideMaterial = kept.override;
      camera.layers.mask = kept.mask;
      for (const o of over()) if (o?.visible && o.parent) renderer.render(o, camera);
    } finally {
      for (const [o, layer] of marked) o.layers.disable(layer);
      renderer.autoClear = kept.autoClear;
      scene.background = kept.background;
      scene.matrixWorldAutoUpdate = kept.auto;
      scene.overrideMaterial = kept.override;
      camera.layers.mask = kept.mask;
    }
  }
  return {
    get active() { return !!roots; },
    get count() { return roots ? roots.length : 0; },
    show(list) { roots = list ? [...list] : null; },     // the matches; null: the search is off, the view as usual
    render,
  };
}
