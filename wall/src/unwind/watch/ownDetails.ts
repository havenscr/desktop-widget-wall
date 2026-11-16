import { youtube } from '../../music/youtube';
import { validId } from './links';

const MAX_ASKED = 2400;
const asked = new Map<string, true>();

function forget(ids: readonly string[]): void {
  for (const id of ids) asked.delete(id);
}

/** Ask YouTube (signed in only) for what an own playlist's videos are missing; `learn` fills absent fields only. */
export function askDetails(ids: readonly string[], learn: (id: string, info: { title?: string; channel?: string; seconds?: number }) => void): void {
  const wanted: string[] = [];
  for (const id of ids) {
    if (!validId('video', id) || asked.has(id) || wanted.includes(id)) continue;
    wanted.push(id);
    asked.set(id, true);
    while (asked.size > MAX_ASKED) asked.delete(asked.keys().next().value as string);
  }
  if (wanted.length === 0) return;
  void (async () => {
    try {
      const status = await youtube.status();
      if (!status.setup || !status.signedIn || status.reason !== null) {
        forget(wanted);
        return;
      }
    } catch {
      forget(wanted);
      return;
    }
    for (let start = 0; start < wanted.length; start += 50) {
      const chunk = wanted.slice(start, start + 50);
      const allowed = new Set(chunk);
      try {
        const answers = await youtube.videos(chunk);
        for (const answer of answers) {
          if (!answer || typeof answer.id !== 'string' || !allowed.has(answer.id)) continue;
          learn(answer.id, { title: answer.title ?? undefined, channel: answer.channel ?? undefined, seconds: answer.seconds ?? undefined });
        }
      } catch {
        forget(chunk);
      }
    }
  })();
}

/** Tests only. */
export function resetOwnDetails(): void {
  asked.clear();
}
