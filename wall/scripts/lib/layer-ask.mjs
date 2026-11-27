// A fit variant that rests the pointer on the music card ("grow") brings the work layer up with it. Those variants say so in
// their query (`layer=up`), and the area's measurement fails when the layer's mark disagrees with the query, so an accidental
// layer-up cannot pass a layer-hidden check and a missing layer cannot pass a layer-shown one.
// A variant that already says what it expects (`layer=up`, or `layer=either` for one whose open menu may take the layer down again (whether it has by the time the page is read is not fixed)) is left as it is. The fit run applies it to every area's variants, since the four music areas' measurements read every page of a full run.
export const askLayer = (variants) => variants.map((v) => (v.click && /(^|\s)grow(\s|$)/.test(v.click) && !/[?&]layer=/.test(v.q) ? { ...v, q: `${v.q}&layer=up` } : v));
