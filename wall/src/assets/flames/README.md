# Flames

`flame-192.webp`, `flame-470.webp` and `flame-522.webp` are three fractal flames,
1920 by 540 pixels. They were rendered for this project with a fractal flame
renderer and are part of the repository's own artwork.

`flame-loop.webm` is the moving backdrop: the same flame as `flame-192.webp`,
1280 by 360, 24 fps, 150 seconds, a seamless loop (VP9, no audio). It is rendered
by `wall/scripts/flame-loop.mjs`, whose header has the exact commands (seed 192,
3600 frames, 6e6 points per frame, then the ffmpeg encode).

They are the backdrop of the Zen place (`wall/src/zen/Flames.tsx`): the video plays;
`flame-192.webp` is the still for reduced motion, and the three stills are the
fallback if the video cannot play.
