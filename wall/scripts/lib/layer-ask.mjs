// A fit variant that rests the pointer on the music card ("grow") brings the work layer up with it. Those variants say so in
// their query (`layer=up`), and the area's measurement fails when the layer's mark disagrees with the query, so an accidental
// layer-up cannot pass a layer-hidden check and a missing layer cannot pass a layer-shown one.
export const askLayer = (variants) => variants.map((v) => (v.click && /(^|\s)grow(\s|$)/.test(v.click) ? { ...v, q: `${v.q}&layer=up` } : v));
