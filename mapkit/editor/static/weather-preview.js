// Selected weather-zone preview. UE uses camera/player-centred precipitation, not the
// ZoneInfo marker's collision radius. This bounded approximation never enters map data.
const shortClass = name => String(name || '').split('.').pop().toLowerCase();
export function weatherKind(actor, chain = []) {
  const names = [actor?.cls, ...chain].map(shortClass);
  return names.includes('snowzone') ? 'snow' : names.includes('precipitationzone') ? 'rain' : null;
}
const finite = (v, fallback) => v == null || v === '' || !Number.isFinite(+v) ? fallback : +v;
export function weatherSettings(actor, read, kind) {
  const wind = String(read(actor, 'Wind') || '');
  const axis = k => finite(new RegExp(`\\b${k}\\s*=\\s*([-+\\d.eE]+)`, 'i').exec(wind)?.[1], 0);
  return { kind, falling: !/^(false|0)$/i.test(String(read(actor, 'bWeatherActive') ?? 'True')),
    density: Math.max(0, Math.min(255, finite(read(actor, 'PrecipDensity'), 7))),
    radius: Math.max(128, Math.min(1600, finite(read(actor, 'PrecipRad'), 800))),
    wind: [axis('X'), axis('Z'), axis('Y')] }; // UE Z up -> Three Y up
}
export function weatherPreviewControl(paused) {
  return `<div class="row"><label style="width:auto" title="Animated preview around the camera while this zone is selected. Uses Falling and How much; roofs clip the preview. Rebuild determines the final zone boundaries in game. This checkbox does not change the map."><input type="checkbox" data-weather-preview ${paused ? '' : 'checked'}> Preview while selected</label></div>`;
}

export function createWeatherPreview({ THREE: T, scene, camera, obstacles = () => [], wake = () => {} }) {
  const capacity = 1800, grid = 10, columns = [], particles = [], paused = new Set();
  const positions = new Float32Array(capacity * 6), flakes = new Float32Array(capacity * 3);
  const ray = new T.Raycaster(), start = new T.Vector3(), end = new T.Vector3(), direction = new T.Vector3();
  const anchor = new T.Vector3(Infinity, Infinity, Infinity);
  const geom = new T.BufferGeometry(), snowGeom = new T.BufferGeometry();
  geom.setAttribute('position', new T.BufferAttribute(positions, 3).setUsage(T.DynamicDrawUsage));
  snowGeom.setAttribute('position', new T.BufferAttribute(flakes, 3).setUsage(T.DynamicDrawUsage));
  const vertex = `varying float perspective; void main() {
    perspective = projectionMatrix[2][3] == -1.0 ? 1.0 : 0.0;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = clamp(1000.0 / max(1.0, -mv.z), 1.5, 6.0);
  }`;
  const material = snow => new T.ShaderMaterial({ transparent: true, depthWrite: false, depthTest: true,
    vertexShader: vertex, fragmentShader: `varying float perspective; void main() {
      if (perspective < 0.5) discard;
      ${snow ? 'float d = length(gl_PointCoord - 0.5); if (d > 0.5) discard; float a = (1.0 - smoothstep(0.2, 0.5, d)) * 0.8;' : 'float a = 0.42;'}
      gl_FragColor = vec4(${snow ? '0.9, 0.94, 1.0' : '0.65, 0.78, 0.92'}, a);
    }` });
  const rain = new T.LineSegments(geom, material(false)), snow = new T.Points(snowGeom, material(true));
  const group = new T.Group(); group.name = 'Weather preview';
  for (const o of [rain, snow]) { o.frustumCulled = false; o.raycast = () => {}; group.add(o); }
  group.visible = false; group.userData.editorPreview = true; scene.add(group);
  let seed = 731, count = 0, cursor = 0, elapsed = 0, lastTrace = -1, name = '', signature = '', running = false, disposed = false;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  for (let i = 0; i < grid * grid; i++) columns.push({ x: (i % grid + random()) / grid * 2 - 1,
    z: (Math.floor(i / grid) + random()) / grid * 2 - 1, length: 0, ready: false, at: new T.Vector3(), dir: new T.Vector3() });
  for (let i = 0; i < capacity; i++) particles.push({ phase: random(), speed: random(), length: 12 + random() * 30, column: i % columns.length });
  function clear() {
    name = signature = ''; paused.clear(); running = group.visible = false; count = 0; elapsed = 0; lastTrace = -1;
    anchor.set(Infinity, Infinity, Infinity); geom.setDrawRange(0, 0); snowGeom.setDrawRange(0, 0);
  }
  function step(dt, source, suspended = false) {
    if (disposed) return;
    const config = source?.settings;
    running = !!(source && !suspended && !paused.has(source.name) && config?.falling && config.density > 0);
    group.visible = running;
    if (!running) { count = 0; geom.setDrawRange(0, 0); snowGeom.setDrawRange(0, 0); return; }
    elapsed += Math.max(0, Math.min(.1, dt));
    const sig = JSON.stringify([source.name, config.kind, config.radius, config.wind, source.revision]);
    if (sig !== signature || anchor.distanceToSquared(camera.position) > 96 * 96) {
      signature = sig; name = source.name; anchor.copy(camera.position); cursor = 0;
      for (const c of columns) c.ready = false;
    }
    const speed = config.kind === 'snow' ? 350 : 1250;
    direction.set(config.wind[0], Math.min(-40, -speed + config.wind[1]), config.wind[2]).normalize();
    // Six columns per frame to start, then a bounded refresh at 10 Hz. No scene-wide
    // raycast per raindrop, no new GPU resources or rebuild when density changes.
    const refresh = cursor < columns.length || elapsed - lastTrace >= .1;
    const solids = refresh ? obstacles() : [];
    if (refresh) lastTrace = elapsed;
    for (let n = 0; refresh && n < 6; n++, cursor++) {
      const c = columns[cursor % columns.length];
      start.copy(anchor); start.x += c.x * config.radius; start.z += c.z * config.radius; start.y += 600;
      c.at.copy(start); c.dir.copy(direction); c.ready = true;
      ray.set(start, end.copy(direction).negate()); ray.near = .1; ray.far = 32768;
      // Starting inside a tall building must not generate drops under its roof.
      if (ray.intersectObjects(solids, false).length) { c.length = 0; continue; }
      ray.set(start, direction); ray.far = 1500 / -direction.y;
      const hit = ray.intersectObjects(solids, false)[0];
      c.length = Math.max(0, Math.min(ray.far, hit ? hit.distance - 2 : ray.far));
    }
    count = Math.min(capacity, Math.ceil(config.density * (config.kind === 'snow' ? 64 : 48)));
    let drawn = 0;
    for (let i = 0; i < count; i++) {
      const p = particles[i], c = columns[p.column];
      if (!c.ready || c.length < 2) continue;
      const v = config.kind === 'snow' ? 300 + p.speed * 100 : 900 + p.speed * 800;
      const travel = (p.phase * c.length + elapsed * v) % c.length;
      start.copy(c.at).addScaledVector(c.dir, travel);
      // Clip both ends of the streak at roofs / floors, not just its head.
      if (config.kind === 'snow') start.toArray(flakes, drawn * 3);
      else {
        end.copy(c.at).addScaledVector(c.dir, Math.min(c.length, travel + p.length));
        start.toArray(positions, drawn * 6); end.toArray(positions, drawn * 6 + 3);
      }
      drawn++;
    }
    rain.visible = config.kind === 'rain'; snow.visible = !rain.visible;
    geom.setDrawRange(0, rain.visible ? drawn * 2 : 0); snowGeom.setDrawRange(0, snow.visible ? drawn : 0);
    if (rain.visible) geom.attributes.position.needsUpdate = true; else snowGeom.attributes.position.needsUpdate = true;
  }
  return { step, clear, get active() { return running; }, isPaused: n => paused.has(n),
    setPaused(n, value) { value ? paused.add(n) : paused.delete(n); if (value && n === name) running = group.visible = false; wake(); },
    get info() { return { name, active: running, count, rendered: rain.visible ? geom.drawRange.count / 2 : snowGeom.drawRange.count,
      columns: columns.filter(c => c.ready && c.length > 0).length }; },
    dispose() { if (disposed) return; clear(); disposed = true; group.removeFromParent(); geom.dispose(); snowGeom.dispose(); rain.material.dispose(); snow.material.dispose(); }
  };
}
