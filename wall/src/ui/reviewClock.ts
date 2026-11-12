import { parseReview, type ReviewFrame } from '../horizon/review';

/**
 * Dev builds only: the frozen frame from `?hz=<place>&at=<ISO time>`, or null. The
 * horizon reads the same URL; the frame, clock and ribbon follow it so a review still
 * shows one moment everywhere.
 */
export const reviewFrame: ReviewFrame | null =
  import.meta.env.DEV && typeof window !== 'undefined' ? parseReview(window.location.search) : null;

/** The review time as a clock function, or undefined outside a review. */
export const reviewNow: (() => number) | undefined = reviewFrame ? () => reviewFrame.ms : undefined;
export const reviewDate: (() => Date) | undefined = reviewFrame ? () => new Date(reviewFrame.ms) : undefined;
