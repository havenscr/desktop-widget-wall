import type { YouTubeCommand } from './urls';

/**
 * The wall's controls send their commands here; the frame on screen fills it in while it is
 * mounted. Returns false when there is no loaded YouTube frame to talk to.
 */
export const playerLink: { send: (func: YouTubeCommand, args?: readonly (number | boolean)[]) => boolean } = {
  send: () => false,
};
