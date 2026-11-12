import { isTauri, mocks } from './tauri';

/** Placeholder art: a 32 by 32 gradient PNG. */
const ART = 'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAJ20lEQVR42g3NvaqCYAAA0Ls5Njo6Oja2BA4NDoFCg0Eg4iCSRD+gJBR8kKAYpCGRiGQ4iA6CQlA4iA6BQ1DQ0tjo2Nh6Oy9w/v7aT6h9b7RvcLtC2le0XTbbeaudYe0z3j6R7aTfjpl2xLeDSduftz3QdrW2bbZ3dnt7bG/Ctp601Ut7VbRB1V4+2vKrLb3bs7o9/rSFb5v/+8OeEHZvYDcYqxDsimJlE8tbWIZhZxw7kVjSx2IGi3gsmGD+HPMA5mqYbWI7G9sesU2I6QmmXrBVgYEKWz4w+YVJb2xWY+MPJnyxX9B5Qp17o3ODOxXSuaKdstnJW50M65zxzonsJP1OzHQivhNMOv6844GOq3Vss7OzO9tjZxN29KSjXjqrogOqzvLRkV8d6d2Z1Z3xpyN8O78Af0L4vYHfYLxC8CuKl008b+EZhp9x/ETiSR+PGTzi8WCC+3PcA7ir4baJ72x8e8Q3Ia4nuHrBVwUOKnz5wOUXLr3xWY2PP7jwxX9B9wl1743uDe5WSPeKdstmN291M6x7xrsnspv0uzHTjfhuMOn6864Huq7Wtc3uzu5uj91N2NWTrnrproouqLrLR1d+daV3d1Z3x5+u8O3+AuIJEfcGcYOJCiGuKFE2ibxFZBhxxokTSSR9ImaIiCeCCeHPCQ8QrkbYJrGzie2R2ISEnhDqhVgVBKiI5YOQX4T0JmY1Mf4Qwpf4Bb0n1Ls3eje4VyG9K9orm7281cuw3hnvnche0u/FTC/ie8Gk5897Hui5Ws82ezu7tz32NmFPT3rqpbcqeqDqLR89+dWT3r1Z3Rt/esK39wuoJ0TdG9QNpiqEuqJU2aTyFpVh1BmnTiSV9KmYoSKeCiaUP6c8QLkaZZvUzqa2R2oTUnpCqRdqVVCgopYPSn5R0pua1dT4Qwlf6hcMntDg3hjc4EGFDK7ooGwO8tYgwwZnfHAiB0l/EDODiB8Ek4E/H3hg4GoD2xzs7MH2ONiEAz0ZqJfBqhiAarB8DOTXQHoPZvVg/BkI38EvoJ8QfW/QN5iuEPqK0mWTzlt0htFnnD6RdNKnY4aOeDqY0P6c9gDtarRt0jub3h7pTUjrCa1e6FVBg4pePmj5RUtvelbT4w8tfOlfwD4h9t5gbzBbIewVZcsmm7fYDGPPOHsi2aTPxgwb8WwwYf056wHW1VjbZHc2uz2ym5DVE1a9sKuCBRW7fLDyi5Xe7Kxmxx9W+LK/gHtC3L3B3WCuQrgrypVNLm9xGcadce5Eckmfixku4rlgwvlzzgOcq3G2ye1sbnvkNiGnJ5x64VYFBypu+eDkFye9uVnNjT+c8OV+wfAJDe+N4Q0eVsjwig7L5jBvDTNseMaHJ3KY9IcxM4z4YTAZ+vOhB4auNrTN4c4ebo/DTTjUk6F6Ga6KIaiGy8dQfg2l93BWD8efofAd/oLRExrdG6MbPKqQ0RUdlc1R3hpl2OiMj07kKOmPYmYU8aNgMvLnIw+MXG1km6OdPdoeR5twpCcj9TJaFSNQjZaPkfwaSe/RrB6NPyPhO/oF0yc0vTemN3haIdMrOi2b07w1zbDpGZ+eyGnSn8bMNOKnwWTqz6cemLra1DanO3u6PU434VRPpupluiqmoJouH1P5NZXe01k9HX+mwnf6C8QnJN4b4g0WK0S8omLZFPOWmGHiGRdPpJj0xZgRI14MJqI/Fz0guppom+LOFrdHcROKeiKqF3FViKASlw9RfonSW5zV4vgjCl/xF8hPSL435BssV4h8ReWyKectOcPkMy6fSDnpyzEjR7wcTGR/LntAdjXZNuWdLW+P8iaU9URWL/KqkEElLx+y/JKltzyr5fFHFr7yL1g8ocW9sbjBiwpZXNFF2VzkrUWGLc744kQukv4iZhYRvwgmC3++8MDC1Ra2udjZi+1xsQkXerJQL4tVsQDVYvlYyK+F9F7M6sX4sxC+i18AnhC4N8ANBhUCrigomyBvgQwDZxycSJD0QcyAiAfBBPhz4AHgasA2wc4G2yPYhEBPgHoBqwKACiwfQH4B6Q1mNRh/gPAFv0B5Qsq9odxgpUKUK6qUTSVvKRmmnHHlRCpJX4kZJeKVYKL4c8UDiqsptqnsbGV7VDahoieKelFWhQIqZflQ5JcivZVZrYw/ivBVfoH2hLR7Q7vBWoVoV1Qrm1re0jJMO+PaidSSvhYzWsRrwUTz55oHNFfTbFPb2dr2qG1CTU809aKtCg1U2vKhyS9NemuzWht/NOGr/YL1E1rfG+sbvK6Q9RVdl8113lpn2PqMr0/kOumvY2Yd8etgsvbnaw+sXW1tm+udvd4e15twrSdr9bJeFWtQrZePtfxaS+/1rF6PP2vhu/4FxhMy7g3jBhsVYlxRo2waecvIMOOMGyfSSPpGzBgRbwQTw58bHjBczbBNY2cb26OxCQ09MdSLsSoMUBnLhyG/DOltzGpj/DGEr/ELrCdk3RvWDbYqxLqiVtm08paVYdYZt06klfStmLEi3gomlj+3PGC5mmWb1s62tkdrE1p6YqkXa1VYoLKWD0t+WdLbmtXW+GMJX+sX7J/Q/t7Y3+B9heyv6L5s7vPWPsP2Z3x/IvdJfx8z+4jfB5O9P997YO9qe9vc7+z99rjfhHs92auX/arYg2q/fOzl115672f1fvzZC9/9L3CekHNvODfYqRDnijpl08lbToY5Z9w5kU7Sd2LGiXgnmDj+3PGA42qObTo729kenU3o6ImjXpxV4YDKWT4c+eVIb2dWO+OPI3ydX3B4Qod743CDDxVyuKKHsnnIW4cMO5zxw4k8JP1DzBwi/hBMDv784IGDqx1s87CzD9vjYRMe9OSgXg6r4gCqw/JxkF8H6X2Y1Yfx5yB8D7/Af0L+veHfYL9C/Cvql00/b/kZ5p9x/0T6Sd+PGT/i/WDi+3PfA76r+bbp72x/e/Q3oa8nvnrxV4UPKn/58OWXL739We2PP77w9X9B8ISCeyO4wUGFBFc0KJtB3goyLDjjwYkMkn4QM0HEB8Ek8OeBBwJXC2wz2NnB9hhswkBPAvUSrIoAVMHyEcivQHoHszoYfwLhG/yC6AlF90Z0g6MKia5oVDajvBVlWHTGoxMZJf0oZqKIj4JJ5M8jD0SuFtlmtLOj7THahJGeROolWhURqKLlI5JfkfSOZnU0/kTCN/oF8ROK7434BscVEl/RuGzGeSvOsPiMxycyTvpxzMQRHweT2J/HHohdLbbNeGfH22O8CWM9idVLvCpiUMXLRyy/Yukdz+p4/ImFb/wL0ieU3hvpDU4rJL2iadlM81aaYekZT09kmvTTmEkjPg0mqT9PPZC6Wmqb6c5Ot8d0E6Z6kqqXdFWkoEqXj1R+pdI7ndXp+JMK35T/B//KNHs11RO5AAAAAElFTkSuQmCC';

/**
 * Realistic answers for the commands the Work and Home tabs call, so `npm run dev` in a
 * plain browser shows content. Registered only in the dev server, never in a
 * production build, never inside Tauri.
 */
export function registerDevMocks(): void {
  if (isTauri()) return;
  let playing = true;
  let dnd = false;
  mocks.set('get_now_playing', () => ({
    title: 'Tokyo Burnout',
    artist: 'Tokyo Rose',
    album: 'Night Drive',
    album_art_base64: ART,
    album_art_mime: 'image/png',
    playback_status: playing ? 'playing' : 'paused',
    source_app: 'Spotify',
    position_seconds: 63,
    duration_seconds: 214,
    shuffle_active: false,
    repeat_mode: 'none',
    art_unchanged: false,
  }));
  mocks.set('media_play_pause', () => {
    playing = !playing;
  });
  mocks.set('media_next', () => undefined);
  mocks.set('media_previous', () => undefined);
  let tasks = [
    { id: 't1', title: 'Send the project proposal', due: 0, allDay: false, hour: 15 },
    { id: 't2', title: 'Review the dashboard draft', due: 1, allDay: true, hour: 0 },
    { id: 't3', title: 'Order printer paper', due: 4, allDay: true, hour: 0 },
    { id: 't4', title: 'Book a dentist visit', due: 9, allDay: true, hour: 0 },
  ];
  mocks.set('wall2_tasks_next', () => {
    const day = (n: number) => {
      const d = new Date();
      d.setDate(d.getDate() + n);
      return d;
    };
    const pad = (n: number) => String(n).padStart(2, '0');
    return tasks.slice(0, 3).map((t) => {
      const d = day(t.due);
      const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      return {
        id: t.id,
        title: t.title,
        due_at: t.allDay ? date : new Date(d.getFullYear(), d.getMonth(), d.getDate(), t.hour).toISOString(),
        due_is_all_day: t.allDay,
        quadrant: null,
      };
    });
  });
  mocks.set('wall2_task_done', (args) => {
    tasks = tasks.filter((t) => t.id !== args?.id);
  });
  mocks.set('wall2_home_security', () => ({
    reachable: true,
    stale: false,
    lastScan: new Date(Date.now() - 4 * 60_000).toISOString(),
    alerts: 2,
    firewalla: { api: 'up', boxOnline: true, checkedAt: new Date().toISOString(), alarms24h: 3 },
    portalUrl: null,
  }));
  mocks.set('wall2_moods', () => [
    { id: 'day', label: 'Day' },
    { id: 'evening', label: 'Evening' },
    { id: 'lateNight', label: 'Late Night' },
  ]);
  mocks.set('wall2_apply_mood', async () => {
    await new Promise((resolve) => setTimeout(resolve, 400));
  });
  mocks.set('get_do_not_disturb', () => dnd);
  mocks.set('enable_do_not_disturb', () => {
    dnd = true;
  });
  mocks.set('disable_do_not_disturb', () => {
    dnd = false;
  });
}
