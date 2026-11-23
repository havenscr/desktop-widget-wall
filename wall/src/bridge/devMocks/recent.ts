import { reviewNow } from '../../ui/reviewClock';
import { canPreview, type RecentFile } from '../../shelf/recent';
import { mocks } from '../tauri';
import { knob } from './long';

/**
 * Dev only: the Shelf Recent files card's answers, with invented file names.
 *
 *   (no knob)        14 files covering every kind, newest first: three today, then Yesterday, weekdays and dates
 *   ?recent=empty    no recent files
 *   ?recent=down     the read fails
 *   ?recent=long     the newest file has a very long name
 *
 * A preview is a small generated picture for a kind that can have one and the word none for the rest.
 *
 * Registered after the other mocks, so a knob wins. Opening a file and showing it in Explorer do nothing.
 */

const clock = reviewNow ?? (() => Date.now());
const MIN = 60_000;

/** Small generated pictures, one colour per kind. */
const PICS: Record<string, string> = {
  image: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAAAwCAIAAAAuKetIAAAB90lEQVR42tXOBzsUAAAG4O/vlIo2yjj7Ms/u7LPPdvbZZ++VvWXvkKKUUSii6bFKUzSMSvup3/G9v+DFYM6/K9l/+7P+9GX+7s341ZP+szvtR1fq986Ugw7Ft3bF17bkL61J+y2Je80Ju03xO41xnxtiP9XLP9bJP9TGbNdEb1VHva+K3KyMeFcR/rY87E2Z7HWp7FVJ6MvikI2i4BeFQc8LAtfzA9by/Fdz/VZypMvZ0qUs32eZPk8zvJ+kez1O9XyU4vFQ4b6YLFlIkjxIdJtPcJ2Ld7kf53wv1mlW7jgT4zAdLb4bJb4TcXEq3H4yzG5CZjseanM7xPpWsNUYqPdBljdBvQ8U3QD1PkA0Cuq9v8UIqPd+5tdBvZeaXQP13td0GNR7b5OroN57GQ+Beu95YRDUew/hAKj37sJ+UO8lRn2g3rsZ9oJ672rQA+q9i343qPfOel2g3jvpdoJ676jTAeq9g6Ad1HuxoA3Ue3vtVlDv7bRaQL231WwG9d5G4zKo99bnm0C9tzrXCOq9pXoDqPcitXpQ7y1U60C9N1etBfXe7GwNqPemZ6pBvTc5XQXqvfGpSlDvhScrQL03OlEO6r3h8TJQ7w1USkG911e5BOq9nnIJqPe6x4pBvdc5WgTqveBIIaj32koFoN5rHc4H9V7zUN5/0zstm475e+UAAAAASUVORK5CYII=',
  document: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAAAwCAIAAAAuKetIAAAB8UlEQVR42tXPh0oUcAAH4N+baGbTzOrOO29453nL23vvfadvUNGiRaVYiVa0aJApLVpUig1atGjQooVWlEWLFlbk/zV+b/B9+N/R8a+9/W+l8qdcmSiXf5fKv4qln8XSj0Lxe774LV/4mit8yeY/Z/OfMrmP6dyHdHY8lX2fzLxLZN4m0m/i6dex1FgsNRpNvookX0YSL8KJ56H4s1D8aTD2JBB7HIg+8kcf+iIPvJH73vA9T/iuO3THHbrtCt5yBm86Azccget2/zW7/6rNd8Xqu2z1XrJ4L7Z5Lpg9583uEZN72OgaMrrOGZxn9Y4zesfpVvspnf2kznaixXZcawW1/pgIUOuPaiyg1h9ptoBaf1jdBmr9IRGg1g+qzKDWDyjNoNYfVJpAre9XmECtP9BkBLV+vwhQ6/fJDaDW75UZQK3fI9ODWr+7UQ9q/S5pK6j1O0WAWr9DogO1fvsCHaj12+a3gFq/VQSo9VvmaUGt72vQglrf26ABtb5nrgbU+s31zaDWbxIBav3GOWpQ67vr1KDWd9WpQK3vnK0CtX7DLCWo9etFgFq/bqYC1Pq1MxSg1q+Z3gRq/WoRoNavmiYHtX5lrRzU+hW1MlDrl0+VgVq/rKYR1PqlIkCtXzJFCmr94mopqPWLqiWg1i+skkwCJDq6ESwZnBAAAAAASUVORK5CYII=',
  sheet: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAAAwCAIAAAAuKetIAAAB/UlEQVR42tXPeU8ScBwH4O+LCAQEBAEBAUFAQLC/zdIsjzIPRBAQOeIQQQ45dJ0rrXXoKrVV2iptabXudS6z1rmyWi+m39v4vIPnoZ3/ppv+TjX9KTt+lx3bJcevkv1n0f6jaP9eaPxWaPw6afuSt33O2z7lrB9z1q2s9UPWspmxvM9Y3k00vE03vEmbX6fMr1Lml+OmF+Om50nTs6Tx6ZjxScL4OFH/KF7/MG54EDPcjxk2ovr1qP7eYf3dSN1apG41rLsT1t0O6W6FtDeD2pWgdnlUcyOguR7QXBupvTpSu+RXL/rVCz71FZ/qsld1yauaH1bOeZQXPcoL7prz7ppzQ4qzQwStV5xxEbReMesiaL18ZpCg9fLTToLWy085CVovOzlA0HrZCRZA1suO9xO0vvoYCyDrq4/2EbReeoQFkPXS6V6C1kunDhG0XlJmAWS9pNRD0HpJsYeg9VWFgwStr8qzALJenDtA0HpxlgWQ9eJMN0HrRRNdBK0XpVkAWS9KdRK0XphkAWS9cKyDoPXCRAdB6yvj+wlaXxljAWS9ILqPoPWCSDtB6wXhdoLW80N7CVrPD7IAsp4/2kbQel6ABZD1PH8rQet5vlaC1ld49xC0vmJ4N0HruR4WQNZz3S0Eree6WghazxncRdB6jpMFkPWcgWaC1u/ob/4PRM3t6wZlB/UAAAAASUVORK5CYII=',
  slides: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAAAwCAIAAAAuKetIAAACBklEQVR42tXPhzfUAQAH8O8fkcvZ1xnHcY5zHOemBk20RSUtadCkkpFxhLNyZhqqR4OeSvVa1GuI11K9dr2Wei3Va3v1+ze+/8Hng3/NEcM7zH+bzH8aTb8bTL/qjT/rjD9qjd9thm82w9ca/Zft+qFq3ecq3adK3ceK8A/l4e+t2ndW7dsy7WBp2JuSsNfbQl8Vh74s0rywaJ5bNM8KQ54WhDzJD36cF/xoq/phrvpBjvp+dtC97KC7Wao7W1QDmarbmwNvbQq8uTHgRkbA9XRlf7qyb4Py2nr/3nX+V9cqrqxRXF6tuJTmdzHN70Kqb88q3+6V8vMr5OeWy8+m+JxZ5nM62ftUsvfJpbITS2Sg1nctloFaf3yRF6j1xxZ6gVp/NMkT1PrOBZ6g1h8RAtT6jkQPUOvb53uAWn94njuo9YfmuoNafzBBCmr9gXgpqPVtc6Sg1rfGjQK1fr8QoNbvmy0BtX7vLAmo9S0zJaDW75nhBmr97uluoNbvmuYKav3Oqa6g1jfHuoBa3yQEqPWNMS6g1jdEO4NaXz/FGdT6uslOoNbXTnICtd420RHU+poJjqDWVwsBan3VeAdQ6yujHECtr4gUg1pfPk4Mar11rBjU+rIx9qDWl462B7W+JGIkqPXFQoBaX2QWgVpvMYlArS80ikCtLzDYgVqfr7cDtT5PN+I/pbk9+2TRflsAAAAASUVORK5CYII=',
  video: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAAAwCAIAAAAuKetIAAACCklEQVR42tXPi0/MAQAH8O8/EXlEoZRHiELRQx6h0uuqq3t0v+7VXXeVLqVcSumU0qWXS6kupVwpJWOMMSbTapmWZRlL0xhjGWMM/8b3P/h88Ddj+I/xxm/D0K/0wZ/66z90A991/d/Sri1o+75qer+oHZ/Vjk+qqx+VPR9Su+eFK++FrjlF57uUy7Pyjrcy+xup/bW0fUbS9iq5dTrp0ktxy5S4eTLx4ouEpufxtgmRbVx0YSyucTS24VlM/dPoupGo2idR5x8fqXkUaX0YYX0QXn0//Ny9w1V3D1XeOXj2dljFrbDymwfODO+3DO2zDO4tGwg93R9a2renpDfklCO4uCeoqDvoZFdgYeduc8cusz3gBKj1bQEFoNa3+ueDWt+y8zio9c078kCtb9qeC2q9ze8YqPWNfjmg1jf4mkCtr9tmArW+dms2qPU1PkdBrbf6ZIFaX70lE9T6qs0ZoNZXbjKCWl/hbQC1vtw7HdR6y0Y9qPVlG/Sg1peu14FaX7IuDdT6Yi8tqPVFXhpQ6ws91aDWm9eqQK0v8FCCWp/vngpqfZ67AGp97hoB1Pqc1QpQ602rUkCtz3aTg1qf5SYDtT7TVQpqvXGlBNR6w4pkUOv1Lkmg1uuWi0Gt1/4PUOs1yxJBrVctTQC1XrkkHtR6wVkEar3COQ7UevniWFDrZYtiQK2XOEX/A+ZSW6Xv5ZozAAAAAElFTkSuQmCC',
};

const SEEDS: { name: string; kind: string; agoMin: number }[] = [
  { name: 'Quarterly review.pptx', kind: 'slides', agoMin: 44 },
  { name: 'Budget 2027.xlsx', kind: 'sheet', agoMin: 128 },
  { name: 'Meeting notes.docx', kind: 'document', agoMin: 215 },
  { name: 'Site photo.png', kind: 'image', agoMin: 1700 },
  { name: 'Project plan.pdf', kind: 'document', agoMin: 3600 },
  { name: 'Launch teaser.mp4', kind: 'video', agoMin: 4300 },
  { name: 'Podcast intro.mp3', kind: 'audio', agoMin: 5200 },
  { name: 'Customer list.csv', kind: 'sheet', agoMin: 6100 },
  { name: 'Release notes.txt', kind: 'other', agoMin: 7400 },
  { name: 'Contract draft.rtf', kind: 'document', agoMin: 9800 },
  { name: 'Logo sketch.svg', kind: 'image', agoMin: 14000 },
  { name: 'Config.json', kind: 'other', agoMin: 20000 },
  { name: 'Workshop recording.mov', kind: 'video', agoMin: 26000 },
  { name: 'Readme.md', kind: 'other', agoMin: 33000 },
];

export function registerRecentMocks(): void {
  const mode = knob('recent');
  mocks.set('wall2_recent_files', () => {
    if (mode === 'down') throw 'failed';
    if (mode === 'empty') return [];
    const base = clock();
    const out: RecentFile[] = SEEDS.map((s, i) => ({ id: `rf${i}`, name: s.name, kind: s.kind, modified: base - s.agoMin * MIN }));
    if (mode === 'long') out[0] = { ...out[0], name: 'Quarterly business review with every region and product line, final version three.pptx' };
    return out;
  });
  mocks.set('wall2_recent_preview', (args) => {
    const id = String((args as { id?: string } | undefined)?.id ?? '');
    const seed = SEEDS[Number(id.replace('rf', ''))];
    return seed && canPreview(seed.name) ? (PICS[seed.kind] ?? PICS.image) : 'none';
  });
  mocks.set('wall2_recent_open', () => undefined);
  mocks.set('wall2_recent_folder', () => undefined);
}
