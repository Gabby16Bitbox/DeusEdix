// Check map's rules about where things are, as Unity's Search finds renderers overlapping others: the same
// object twice at one spot, probably a double paste (Ctrl+D, Ctrl+V, an Alt+drag let go where it began: in Deus Ex
// two pickups, two lights, a door twice), and a decoration or a thing to pick up left in the air. Pure: app.js
// (checkMap) gives the objects as the 3D view has them, their classes' chains and the rays down, and runs the fixes
// (delete the extra copy, Drop to floor).
import { sameRotation } from './view-align.js';

// two things of one class closer than this (units) and turned the same way are one object twice
export const STACK_NEAR = 2;
// a thing whose bottom is more than this (units) above the surface under it is left in the air
export const AIR_GAP = 8;

// What the game drops to the floor when the map starts: their classes' Physics is PHYS_Falling (DeusEx.u's
// DeusExDecoration, Engine.u's Inventory: every thing to pick up, weapons and ammo too).
export const FALLING = ['DeusExDecoration', 'Inventory'];
// Under them, the game's classes made to hang, to sit on a wall or to stay where they are put: their own Physics is
// None, Rotating or Rolling, or they do not collide with the world (the default properties of DeusEx.u and of
// Revision's decorations; the editor's own models, UCMeshDeco). A class under one of these is left out too.
export const STAYS_UP = [
  // DeusEx.u
  'ATM', 'AlarmLight', 'AutoTurret', 'BobPageAugmented', 'Button1', 'CageLight', 'CeilingFan', 'CeilingFanMotor',
  'CigaretteMachine', 'ComputerPublic', 'ComputerSecurity', 'DentonClone', 'Fan1', 'Fan1Vertical', 'Fan2', 'Faucet',
  'HKMarketTarp', 'HKTukTuk', 'HackableDevices', 'HangingDecoration', 'LifeSupportBase', 'LightSwitch', 'Lightbulb',
  'LuciusDeBeers', 'Mailbox', 'NYEagleStatue', 'NYLiberty', 'NYLibertyTop', 'NYLibertyTorch', 'OutdoorThings', 'Poolball',
  'ShipsWheel', 'ShopLight', 'ShowerFaucet', 'ShowerHead', 'SubwayControlPanel', 'Switch1', 'Switch2', 'Toilet', 'Toilet2',
  'Valve', 'Vehicles', 'WaterFountain',
  // Revision's decorations
  'DXCollectable', 'GreenPlasticBox', 'HandDry', 'LightTube', 'RedPlasticBox', 'Rev_SphereLight', 'TNMCeilingLight',
  'TechLamp2', 'ToiletPaper', 'TowelRack',
  // the editor's own
  'UCMeshDeco',
];

// Does the game drop this thing to the floor when the map starts? chain: its class and the classes above it;
// physics, collideWorld: what is set on the object itself (undefined: its class's). A thing set to stay where it is
// (Physics other than PHYS_Falling: Stick to surface sets None) or not colliding with the world is left in the air on
// purpose.
export function fallsWhenLoaded(chain, physics, collideWorld) {
  if (!chain.some((c) => FALLING.includes(c)) || chain.some((c) => STAYS_UP.includes(c))) return false;
  if (physics !== undefined && physics !== null && physics !== '' && String(physics) !== 'PHYS_Falling') return false;
  return String(collideWorld ?? 'True').toLowerCase() !== 'false';
}

// how far a thing is left in the air: its bottom over the surface under it (heights in units), 0 when it is down
export function airGap(bottom, floor) {
  const gap = bottom - floor;
  return gap > AIR_GAP ? gap : 0;
}

const near = (a, b, d) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) <= d;
// what an object's properties say, as one text: the same for the same values, in any order and as text or number
export function propertiesKey(props) {
  return JSON.stringify(Object.keys(props || {}).sort().map((k) => [k, String(props[k])]));
}

// The things that are another one twice: of one class, turned the same way, within `within` units of it, with the same
// properties (a double paste has its original's: two sounds, triggers or lights put at one spot on purpose are set
// differently, and stay). things: [{name, cls, loc, rot, rank, mine, props}]; rank: which one stays (the lowest:
// there first), mine: added or changed in the editor (two of the map's own objects are as the game has them), props:
// the properties it has now. One {extra, of} for every copy over the first.
export function stackedCopies(things, within = STACK_NEAR) {
  const byClass = new Map();
  for (const t of things) if (t.loc) (byClass.get(t.cls) || byClass.set(t.cls, []).get(t.cls)).push({ ...t, key: propertiesKey(t.props) });
  const out = [];
  for (const list of byClass.values()) {
    if (list.length < 2) continue;
    const kept = [];
    for (const t of [...list].sort((a, b) => a.rank - b.rank)) {
      const first = kept.find((k) => near(k.loc, t.loc, within) && sameRotation(k.rot || [], t.rot || []) && k.key === t.key);
      if (!first) kept.push(t);
      else if (first.mine || t.mine) out.push({ extra: t.name, of: first.name });
    }
  }
  return out;
}
