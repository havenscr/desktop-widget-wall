import { PLACES, usePlaceStore } from '../state/places';

/** Placeholder screens: each shows only the place name. */
export function Screens() {
  const active = usePlaceStore((s) => s.active);
  const label = PLACES.find((p) => p.id === active)?.label ?? '';
  return (
    <section className="screen" data-place={active}>
      <h1>{label}</h1>
    </section>
  );
}
