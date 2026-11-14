import { DEFAULT_LINES, LINE_PRESETS, useLinesStore, type LineColours, type LineRest, type LineType } from '../../horizon/linesSettings';

const TYPES: { id: LineType; name: string; hint: string }[] = [
  { id: 'mountains', name: 'Mountains', hint: 'The ridgelines dance as they do today.' },
  { id: 'bars', name: 'Bars', hint: 'Mirrored columns with falling peak markers.' },
  { id: 'ribbon', name: 'Ribbon', hint: 'A bright wave with two soft trails.' },
  { id: 'sparks', name: 'Sparks', hint: 'A row of dots thrown upward by each hit.' },
  { id: 'skyline', name: 'Skyline', hint: 'Music builds blocks in twelve pixel floors.' },
];
const COLOURS: { id: LineColours; name: string }[] = [
  { id: 'look', name: 'Look' }, { id: 'floor', name: 'Floor' }, { id: 'sunset', name: 'Sunset' }, { id: 'ice', name: 'Ice' }, { id: 'mint', name: 'Mint' },
];

function Slider({ field, label, min, max, suffix = '' }: { field: 'lively' | 'smooth' | 'height'; label: string; min: number; max: number; suffix?: string }) {
  const value = useLinesStore((s) => s[field]);
  const usual = DEFAULT_LINES[field];
  const set = useLinesStore((s) => s.setLines);
  return <label className="ln-slider" title={`${label}: arrow keys move the value`}><span>{label}<b>{value}{suffix}{value === usual ? ' (your usual)' : ''}</b></span><input type="range" min={min} max={max} value={value} style={{ '--usual': `${((usual - min) / (max - min)) * 100}%` } as React.CSSProperties} onChange={(e) => set({ [field]: Number(e.target.value) })} /></label>;
}

export function LinesPanel() {
  const s = useLinesStore();
  const set = s.setLines;
  const selected = TYPES.find((x) => x.id === s.type)!;
  return <div className="ln-panel">
    <section><h3>Type</h3><div className="ln-types" role="radiogroup" aria-label="Line type">{TYPES.map((x) => <button key={x.id} type="button" role="radio" aria-checked={s.type === x.id} className={s.type === x.id ? 'on' : ''} title={x.hint} onClick={() => set({ type: x.id })}>{x.name}</button>)}</div><p>{selected.hint}</p></section>
    <div className="ln-sliders"><Slider field="lively" label="How lively" min={0} max={100} /><Slider field="smooth" label="Smoothness" min={0} max={100} /><Slider field="height" label="Height" min={20} max={220} suffix=" px" /></div>
    <section><h3>Colours</h3><div className="ln-colours" role="radiogroup" aria-label="Line colours">{COLOURS.map((x) => <button key={x.id} type="button" role="radio" aria-checked={s.colours === x.id} className={`${x.id}${s.colours === x.id ? ' on' : ''}`} title={`${x.name} palette`} onClick={() => set({ colours: x.id })}><i />{x.name}</button>)}</div></section>
    <div className="ln-row"><label title="Mirror the lines in the floor"><input type="checkbox" checked={s.reflection} onChange={(e) => set({ reflection: e.target.checked })} />Reflection</label><div role="radiogroup" aria-label="At rest"><span>At rest</span>{([['ridgelevels', 'Ridge and levels'], ['flat', 'Flat']] as [LineRest, string][]).map(([id, name]) => <button type="button" role="radio" aria-checked={s.rest === id} className={s.rest === id ? 'on' : ''} key={id} onClick={() => set({ rest: id })}>{name}</button>)}</div></div>
    <div className="ln-actions"><span>Presets</span>{Object.entries(LINE_PRESETS).map(([name, preset]) => <button type="button" key={name} title={`Set ${name} movement`} onClick={() => set(preset)}>{name[0].toUpperCase() + name.slice(1)}</button>)}<button type="button" className="reset" onClick={s.reset}>Reset to my usual</button></div>
    <p className="ln-foot">One setting for the lines everywhere music plays.</p>
  </div>;
}
