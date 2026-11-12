import { reviewNow } from '../../ui/reviewClock';
import { mocks } from '../tauri';

type Est = '15' | '30' | '45' | '60plus' | null;
interface MockTask {
  id: string;
  title: string;
  /** Days from today. */
  due: number;
  allDay: boolean;
  hour: number;
  estimate: Est;
  tags: string[];
  /** Index into BUCKETS. */
  bucket: number;
}

/** Fictional lists, shaped like the task app's `/api/buckets`. */
const BUCKETS = [
  { id: '01HZZZZZZZZZZZZZZZZZZZZ001', name: 'Tasks (To-Do)' },
  { id: '01HZZZZZZZZZZZZZZZZZZZZ002', name: 'Tax / Business' },
  { id: '01HZZZZZZZZZZZZZZZZZZZZ003', name: 'House, garden' },
];

const pad = (n: number) => String(n).padStart(2, '0');
const day = (n: number) => {
  // Days count from the review's date in a review still (`?hz=&at=`).
  const d = new Date(reviewNow ? reviewNow() : Date.now());
  d.setDate(d.getDate() + n);
  return d;
};

function toItem(t: MockTask) {
  const d = day(t.due);
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return {
    id: t.id,
    title: t.title,
    due_at: t.allDay ? date : new Date(d.getFullYear(), d.getMonth(), d.getDate(), t.hour).toISOString(),
    due_is_all_day: t.allDay,
    quadrant: null,
    est: t.estimate,
  };
}

const estMinutes = (e: Est) => (e === '60plus' ? 60 : e ? Number(e) : 0);

/** The task card, plus the summary the Work and Home screens read. */
export function registerTaskMocks(): void {
  let tasks: MockTask[] = [
    { id: 't1', title: 'Send the project proposal', due: 0, allDay: false, hour: 15, estimate: '45', tags: ['work'], bucket: 0 },
    { id: 't2', title: 'Review the dashboard draft', due: 1, allDay: true, hour: 0, estimate: '30', tags: ['work'], bucket: 0 },
    { id: 't3', title: 'Order printer paper', due: 4, allDay: true, hour: 0, estimate: '15', tags: ['home', 'errand'], bucket: 2 },
    { id: 't4', title: 'Book a dentist visit', due: 9, allDay: true, hour: 0, estimate: null, tags: ['home'], bucket: 2 },
    { id: 't5', title: 'Fix the garage door', due: 1, allDay: true, hour: 0, estimate: '60plus', tags: ['home'], bucket: 2 },
    { id: 't6', title: 'Water the plants', due: 2, allDay: true, hour: 0, estimate: '15', tags: ['home'], bucket: 2 },
    { id: 't7', title: 'Sort the recycling', due: 6, allDay: true, hour: 0, estimate: '15', tags: ['home'], bucket: 2 },
    { id: 't8', title: 'File the quarterly return', due: 12, allDay: true, hour: 0, estimate: '30', tags: ['finance'], bucket: 1 },
  ];
  mocks.set('wall2_tasks_next', () => tasks.slice(0, 3).map(toItem));
  mocks.set('wall2_task_done', (args) => {
    tasks = tasks.filter((t) => t.id !== args?.id);
  });
  mocks.set('wall2_tasks_summary', (args) => {
    const tag = typeof args?.tag === 'string' ? args.tag.trim().toLowerCase() : null;
    const notTag = typeof args?.notTag === 'string' ? args.notTag.trim().toLowerCase() : null;
    const list = typeof args?.list === 'string' ? args.list.trim().toLowerCase() : null;
    const bucket = list === null ? null : BUCKETS.findIndex((b) => b.name.toLowerCase() === list);
    const has = (t: MockTask, want: string) => t.tags.some((x) => x.toLowerCase() === want);
    const open = tasks
      .filter((t) => tag === null || has(t, tag))
      .filter((t) => notTag === null || !has(t, notTag))
      .filter((t) => bucket === null || t.bucket === bucket);
    const tomorrow = open.filter((t) => t.due === 1);
    return {
      next: open.slice(0, 3).map(toItem),
      remaining: Math.max(0, open.length - 3),
      dueTomorrow: { count: tomorrow.length, estMinutes: tomorrow.reduce((sum, t) => sum + estMinutes(t.estimate), 0) },
    };
  });
}
