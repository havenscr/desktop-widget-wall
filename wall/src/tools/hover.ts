import { tip } from '../ui/HoverTip';

/** The shared hover card, plus a marker the fit check reads: text that may be cut sits under one of these. */
export function hover(content: Parameters<typeof tip>[0]) {
  return { ...tip(content), 'data-tip': '' };
}
