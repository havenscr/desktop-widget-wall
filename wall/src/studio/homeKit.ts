// Test helpers for the home half of studio lights: an invented studio answer in the native shape.

type Json = Record<string, unknown>;

export const group = (id: string, label: string, on: boolean, level: number, over: Json = {}): Json => ({
  id,
  label,
  on,
  setTo: on ? `White ${level}%` : 'Off',
  colour: id === 'panels' || !on ? null : '#fff1dd',
  canSwitch: true,
  canDim: true,
  level: on ? level : 0,
  floor: id === 'panels' ? null : 45,
  reachable: true,
  ...over,
});

/** A studio answer: two presets, three groups, two looks; nothing on, writes allowed. */
export function studioAnswer(over: Json = {}): Json {
  return {
    stale: false,
    presets: [
      { id: 'onAir', label: 'On air', line: 'Key lights on, panels glow', active: false, setsKeyLights: true },
      { id: 'recording', label: 'Recording', line: 'Room 80%', active: false, setsKeyLights: false },
    ],
    changed: false,
    groups: [group('panels', 'Panels', false, 70), group('behindMonitor', 'Behind monitor', true, 80), group('overhead', 'Overhead', true, 90)],
    keys: { canSet: false, left: null, right: null },
    looks: [
      { id: 'glow', label: 'Glow', active: false },
      { id: 'calm', label: 'Calm', active: false },
    ],
    canNormal: false,
    normalLine: null,
    canWrite: true,
    writeBlock: null,
    ...over,
  };
}

/** The same with a preset on. */
export function studioWith(active: string, over: Json = {}): Json {
  const base = studioAnswer();
  return studioAnswer({
    presets: (base.presets as Json[]).map((p) => ({ ...p, active: p.id === active })),
    canNormal: true,
    normalLine: 'Goes back to how the room was before',
    ...over,
  });
}
