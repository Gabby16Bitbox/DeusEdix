// A zone's echo (the Inspector's Reverb row, as Unity's Audio Reverb Zone presets): Unreal Engine 1's ZoneInfo reverb,
// bReverbZone, MasterGain, CutoffHz, Delay[6] and Gain[6], which the original game's Galaxy audio plays (Revision's
// OpenAL audio imitates it: EmulateOldReverb), and Revision's own: a RevZoneInfo's (and RevSoundZone's) ReverbPreset,
// one of OpenAL's EFX reverbs, which its OpenAL audio uses instead. A preset sets them all in one step; Custom is the
// zone's own values. No page here: tested with node.
// A zone class with ReverbPreset (Revision's RevZoneInfo, RevSoundZone, WaterZone, PrecipitationZone, SnowZone) also
// declares a float Gain of its own, OpenAL's EFX gain (0-1, the class 0.32; RevZoneInfo.uc), which hides ZoneInfo's
// byte Gain[6] under the same name: there a preset sets no echo gains (presetProps), the echoes keep the class's.
// A WaterZone's own ReverbPreset is RP_Underwater (WaterZone.uc), which its QueryEffects gives OpenAL whether its echo
// is on or not: the presets leave it there, None puts it back (presetProps).
import { sameText } from './prop-sets.js';

export const ECHOES = 6;
export const EFX = 'ReverbPreset';
// The presets' numbers, as the engine takes them (bytes, 0-255, but CutoffHz):
// - Delay: when an echo comes back, in milliseconds after the sound. An echo's delay is the extra way it travels off
//   the walls: sound goes about 34 cm in a millisecond, about 18 units (JC is 88 units, about 1.7 m, tall).
// - Gain: how loud that echo is (255: as loud as the sound itself); MasterGain: all the echoes together.
// - CutoffHz: the echoes lose what is above this frequency: hard bare walls give the highs back (6000-8000), carpet,
//   ceiling tiles and rock swallow them (1000-3500).
// The class's own echo (bReverbZone on, nothing else set): 20 and 34 ms at 150 and 70, MasterGain 100, CutoffHz 6000.
// - Small room: a bare room of 3-4 m (about 200 units across): the first echoes after 12-30 ms, short and soft.
// - Office: furnished, 6-10 m: the class's own timing (20 and 34 ms), duller and quieter.
// - Hall: the game's own big rooms (NSF headquarters, the MJ12 lab in Hong Kong), as their ZoneInfos have it.
// - Tunnel / Sewer: narrow, hard and wet: echoes 17 ms apart (walls 3 m apart give that flutter) dying slowly.
// - Hangar: huge and metal: echoes far apart, up to the longest a byte allows, bright.
// - Cave: big irregular rock: long and dark.
// efx: Revision's EFX preset for it (RevZoneInfo's EReverbPreset).
export const REVERB_PRESETS = [
  { id: 'none', label: 'None', on: false, efx: 'RP_None' },
  { id: 'small', label: 'Small room', on: true, master: 80, cutoff: 6000, delay: [12, 20, 30, 0, 0, 0], gain: [110, 60, 30, 0, 0, 0], efx: 'RP_Room' },
  { id: 'office', label: 'Office', on: true, master: 70, cutoff: 3500, delay: [20, 34, 50, 0, 0, 0], gain: [110, 60, 30, 0, 0, 0], efx: 'RP_LivingRoom' },
  { id: 'hall', label: 'Hall', on: true, master: 100, cutoff: 6000, delay: [50, 75, 100, 125, 150, 200], gain: [100, 60, 50, 40, 30, 20], efx: 'RP_Auditorium' },
  { id: 'tunnel', label: 'Tunnel / Sewer', on: true, master: 120, cutoff: 5000, delay: [17, 34, 51, 68, 85, 102], gain: [150, 120, 95, 75, 55, 40], efx: 'RP_SewerPipe' },
  { id: 'hangar', label: 'Hangar', on: true, master: 120, cutoff: 7000, delay: [60, 100, 140, 180, 220, 255], gain: [120, 95, 75, 55, 40, 25], efx: 'RP_Hangar' },
  { id: 'cave', label: 'Cave', on: true, master: 120, cutoff: 2000, delay: [40, 70, 110, 150, 200, 250], gain: [130, 110, 85, 65, 45, 30], efx: 'RP_Cave' },
];
const PRESET = Object.fromEntries(REVERB_PRESETS.map((p) => [p.id, p]));
const echoes = (name) => Array.from({ length: ECHOES }, (_, i) => `${name}(${i})`);
export const DELAYS = echoes('Delay'), GAINS = echoes('Gain');
// Custom's numbers: [key, label, help, most]
export const REVERB_LEVELS = [
  ['MasterGain', 'Echo loudness', 'MasterGain: all the echoes together (0-255; the class has 100)', 255],
  ['CutoffHz', 'Cutoff (Hz)', 'CutoffHz: the echoes lose what is above this frequency (the class has 6000; lower is duller)', 22050],
];

// What a box of Custom's numbers stores for the text typed in it (UnrealEd's text): a whole number from 0 to most (its
// REVERB_LEVELS most, 255 for a byte), whatever was typed or pasted
export function reverbValue(text, most) {
  return String(Math.max(0, Math.min(most, Math.round(+text || 0))));
}

// The properties a preset gives a zone ({key: UnrealEd text}), as the Properties keep them (Delay(0)...); efx: its
// class has Revision's ReverbPreset, given as the class's own preset (its field's default: 'RP_None', a WaterZone's
// 'RP_Underwater'; true is 'RP_None'). None turns the echo off and leaves its numbers as they are.
// With efx, no Gain(i): that class's Gain is OpenAL's float (above), a Gain(0) of 120 would be an EFX gain of 120
// and Gain(1)..Gain(5) would be lost (B6 in the game, 28 Oct 2026). Its echoes keep the class's gains (150 and 70,
// then none) and its EFX gain stays the class's.
// A class whose own preset is not RP_None keeps it: the other presets leave ReverbPreset alone there and None writes the
// class's own (an earlier preset or a hand change undone), so a water zone as it comes is None, not Custom, and keeps its
// underwater reverb (28 Oct 2026: None wrote RP_None over it).
export function presetProps(id, efx) {
  const p = PRESET[id], out = { bReverbZone: p.on ? 'True' : 'False' };
  if (p.on) {
    out.MasterGain = String(p.master);
    out.CutoffHz = String(p.cutoff);
    for (let i = 0; i < ECHOES; i++) {
      out[DELAYS[i]] = String(p.delay[i]);
      if (!efx) out[GAINS[i]] = String(p.gain[i]);
    }
  }
  if (efx) {
    const own = efx === true ? 'RP_None' : String(efx);             // the class's own OpenAL reverb
    if (id === 'none') out[EFX] = own;
    else if (own === 'RP_None') out[EFX] = p.efx;
  }
  return out;
}

// The preset a zone's values are (read(key): the text it has, edited, the map's or its class's), 'custom' when none;
// efx as presetProps takes it (where the class's own preset is not RP_None, ReverbPreset counts only for None)
export function presetOf(read, efx) {
  const p = REVERB_PRESETS.find((x) => Object.entries(presetProps(x.id, efx)).every(([k, v]) => sameText(read(k) ?? '', v)));
  return p ? p.id : 'custom';
}
