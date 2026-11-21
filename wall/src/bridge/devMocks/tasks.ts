import { knob, longOr } from './long';
import { reviewNow } from '../../ui/reviewClock';
import { mocks } from '../tauri';
import { TODAY_ONLY_KEY } from '../../home/useChores';

type Est = '15' | '30' | '45' | '60plus' | null;
interface MockTask {
  id: string;
  title: string;
  /** Days from today. */
  due: number;
  allDay: boolean;
  hour: number;
  /** Minute of the hour for a timed task (0 when absent). */
  minute?: number;
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

interface MockTag {
  label: string;
  icon: string | null;
  color: string | null;
}

/**
 * Invented tags, shaped as Rust sends them (`label`, `icon`, `color`): a two letter tag, one typed
 * with capitals, one with no colour and no icon, one whose icon name is not in the Tabler set,
 * and a few plain ones. Keys are the lower-cased names a task carries.
 */
const TAG_META: Record<string, MockTag> = {
  errands: { label: 'Errands', icon: 'shopping-cart', color: 'orange' },
  errand: { label: 'Errand', icon: 'shopping-cart', color: 'orange' },
  garden: { label: 'Garden', icon: 'plant-2', color: 'green' },
  'phone call': { label: 'Phone Call', icon: 'phone', color: 'blue' },
  repairs: { label: 'Repairs', icon: 'tool', color: 'pink' },
  hr: { label: 'HR', icon: 'users', color: 'teal' },
  'q4 planning': { label: 'Q4 Planning', icon: 'chart-bar', color: 'magenta' },
  misc: { label: 'Misc', icon: null, color: null },
  ideas: { label: 'Ideas', icon: 'not-a-real-icon', color: 'lime' },
  finance: { label: 'Finance', icon: 'coin', color: 'slate' },
  work: { label: 'Work', icon: 'briefcase', color: 'blue' },
  'an unusually long tag name here': { label: 'An Unusually Long Tag Name Here', icon: 'ruler', color: 'khaki' },
};

/** A task's tags as the page gets them: up to three, never the tag the read filtered by. */
function shownTags(t: MockTask, filtered: string | null): MockTag[] {
  return t.tags
    .filter((x) => x.toLowerCase() !== filtered)
    .slice(0, 3)
    .map((x) => TAG_META[x.toLowerCase()] ?? { label: x, icon: null, color: null });
}

function toItem(t: MockTask, filtered: string | null = null) {
  const d = day(t.due);
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return {
    id: t.id,
    title: t.title,
    due_at: t.allDay ? date : new Date(d.getFullYear(), d.getMonth(), d.getDate(), t.hour, t.minute ?? 0).toISOString(),
    due_is_all_day: t.allDay,
    quadrant: null,
    est: t.estimate,
    tags: shownTags(t, filtered),
  };
}

const estMinutes = (e: Est) => (e === '60plus' ? 60 : e ? Number(e) : 0);

/** The task card, plus the summary the Work and Home screens read. */
export function registerTaskMocks(): void {
  let tasks: MockTask[] = [
    { id: 't1', title: longOr('Send the project proposal', 'Send the project proposal with the revised budget and the new timeline'), due: 0, allDay: false, hour: 15, estimate: '45', tags: ['work'], bucket: 0 },
    { id: 't2', title: 'Review the dashboard draft', due: 1, allDay: true, hour: 0, estimate: '30', tags: ['work'], bucket: 0 },
    { id: 't3', title: 'Order printer paper', due: 4, allDay: true, hour: 0, estimate: '15', tags: ['home', 'errands'], bucket: 2 },
    { id: 't4', title: 'Book a dentist visit', due: 9, allDay: true, hour: 0, estimate: null, tags: ['home', 'phone call', 'errands'], bucket: 2 },
    { id: 't5', title: 'Fix the garage door', due: 1, allDay: true, hour: 0, estimate: '60plus', tags: ['home', 'repairs', 'phone call', 'errands'], bucket: 2 },
    { id: 't6', title: 'Water the plants', due: 2, allDay: true, hour: 0, estimate: '15', tags: ['home', 'garden'], bucket: 2 },
    { id: 't7', title: 'Sort the recycling', due: 6, allDay: true, hour: 0, estimate: '15', tags: ['home'], bucket: 2 },
    { id: 't8', title: 'File the quarterly return', due: 12, allDay: true, hour: 0, estimate: '30', tags: ['finance'], bucket: 1 },
    { id: 't9', title: 'Renew the domain names', due: 14, allDay: true, hour: 0, estimate: '15', tags: ['work'], bucket: 1 },
    { id: 't10', title: 'Write the workshop outline for the spring conference', due: 16, allDay: true, hour: 0, estimate: '60plus', tags: ['work'], bucket: 0 },
    { id: 't11', title: 'Clear the shared drive', due: 20, allDay: true, hour: 0, estimate: null, tags: [], bucket: 0 },
  ];
  // Due today (Work's list). `?due=none|one|two|three|twelve` sets how many are due today or overdue; without it
  // six are due, one of them overdue. Tags run from none to three, with long titles and a long tag.
  const dueToday: MockTask[] = [
    { id: 'd1', title: 'Send the signed engagement letter', due: -2, allDay: true, hour: 0, estimate: '15', tags: ['finance'], bucket: 1 },
    { id: 'd2', title: 'Review the dashboard draft before the client call', due: 0, allDay: true, hour: 0, estimate: '30', tags: ['work', 'phone call', 'q4 planning'], bucket: 0 },
    { id: 'd3', title: 'Confirm the venue for the spring workshop', due: 0, allDay: false, hour: 17, estimate: '15', tags: ['hr'], bucket: 0 },
    { id: 'd4', title: 'Reply to the audit questions', due: 0, allDay: true, hour: 0, estimate: null, tags: [], bucket: 1 },
    { id: 'd5', title: 'Update the onboarding checklist', due: 0, allDay: true, hour: 0, estimate: '45', tags: ['ideas', 'misc'], bucket: 0 },
    { id: 'd6', title: 'Book the travel for the offsite', due: -1, allDay: true, hour: 0, estimate: '60plus', tags: ['errands', 'repairs', 'garden'], bucket: 0 },
    { id: 'd7', title: 'Prepare the quarterly numbers for the board pack and the lenders', due: 0, allDay: true, hour: 0, estimate: '60plus', tags: ['an unusually long tag name here', 'finance'], bucket: 1 },
    { id: 'd8', title: 'Check the backup report', due: 0, allDay: true, hour: 0, estimate: '15', tags: ['misc'], bucket: 0 },
    { id: 'd9', title: 'Call the accountant', due: 0, allDay: false, hour: 11, estimate: '15', tags: ['phone call', 'finance'], bucket: 1 },
    { id: 'd10', title: 'Tidy the shared folders', due: 0, allDay: true, hour: 0, estimate: '30', tags: ['work'], bucket: 0 },
    { id: 'd11', title: 'Approve the new vendor terms', due: 0, allDay: true, hour: 0, estimate: '15', tags: [], bucket: 1 },
    { id: 'd12', title: 'Draft the renewal note', due: 0, allDay: true, hour: 0, estimate: '30', tags: ['q4 planning'], bucket: 0 },
  ];
  const dueMode = knob('due');
  const inDue = (t: MockTask) => t.due <= 0;
  if (dueMode === 'none') tasks = tasks.filter((t) => !inDue(t));
  else if (dueMode === 'one') tasks = [...tasks.filter((t) => !inDue(t) || t.id === 't1')];
  else if (dueMode === 'two') tasks = [...tasks.filter((t) => !inDue(t) || t.id === 't1'), dueToday[0]!];
  else if (dueMode === 'three') tasks = [...tasks.filter((t) => !inDue(t) || t.id === 't1'), ...dueToday.slice(1, 3)];
  else if (dueMode === 'twelve') tasks = [...tasks, ...dueToday.slice(0, 11)];
  else tasks = [...tasks, ...dueToday.slice(0, 5)];
  // `?later=1` turns on the Later today switch, so timed tasks due later today show.
  if (knob('later') === '1') {
    try {
      localStorage.setItem('wall.tasks.showLater', '1');
    } catch {
      /* storage can be blocked */
    }
  }
  // `?chores=many`: thirteen home chores; `?chores=timed` adds one due this afternoon at 4:30 PM beside the estimate pills (Home shows five rows that scroll, and "8 more").
  const chores = knob('chores');
  // Around the house starts with Today only on; the chore states below list undated chores, so they turn it off unless `?todayonly=on`.
  if (chores) {
    try {
      localStorage.setItem(TODAY_ONLY_KEY, knob('todayonly') === 'on' ? 'on' : 'off');
    } catch {
      /* storage can be blocked */
    }
  }
  if (chores === 'many' || chores === 'timed') {
    const extra = ['Change the furnace filter', 'Call the chimney sweep', 'Renew the car tabs', 'Clean the gutters', 'Oil the squeaky hinge', 'Test the smoke alarms', 'Wash the front windows', 'Restock the pantry'];
    tasks = [...tasks, ...extra.map((title, i): MockTask => ({ id: `th${i + 1}`, title, due: 3 + i, allDay: true, hour: 0, estimate: i % 3 === 0 ? '15' : i % 3 === 1 ? '30' : null, tags: ['home'], bucket: 2 }))];
  }
  if (chores === 'timed') {
    tasks = [{ id: 'tt1', title: 'Pick up the dry cleaning', due: 0, allDay: false, hour: 16, minute: 30, estimate: '15', tags: ['home', 'errands'], bucket: 2 }, ...tasks];
  }
  mocks.set('wall2_tasks_lists', () => BUCKETS.map((b) => b.name));
  mocks.set('wall2_tasks_next', () => tasks.slice(0, 3).map((t) => toItem(t)));
  mocks.set('wall2_open_task', () => undefined);
  mocks.set('wall2_task_done', (args) => {
    tasks = tasks.filter((t) => t.id !== args?.id);
  });
  mocks.set('wall2_tasks_summary', (args) => {
    const tag = typeof args?.tag === 'string' ? args.tag.trim().toLowerCase() : null;
    const notTag = typeof args?.notTag === 'string' ? args.notTag.trim().toLowerCase() : null;
    const list = typeof args?.list === 'string' ? args.list.trim().toLowerCase() : null;
    const due = args?.due === 'today';
    const bucket = list === null ? null : BUCKETS.findIndex((b) => b.name.toLowerCase() === list);
    const has = (t: MockTask, want: string) => t.tags.some((x) => x.toLowerCase() === want);
    let open = tasks
      .filter((t) => tag === null || has(t, tag))
      .filter((t) => notTag === null || !has(t, notTag))
      .filter((t) => bucket === null || t.bucket === bucket);
    const tomorrow = open.filter((t) => t.due === 1);
    // The due filter keeps today and overdue, overdue first (the real read does the same).
    if (due) open = [...open.filter((t) => t.due < 0 && inDue(t)), ...open.filter((t) => t.due === 0)];
    // Home's chores ask for more rows (`limit`, 1 to 20; 60 with the due filter); everyone else gets three.
    const cap = due ? 60 : 20;
    const limit = typeof args?.limit === 'number' ? Math.min(cap, Math.max(1, Math.floor(args.limit))) : 3;
    return {
      next: open.slice(0, limit).map((t) => toItem(t, tag)),
      remaining: Math.max(0, open.length - limit),
      dueTomorrow: { count: tomorrow.length, estMinutes: tomorrow.reduce((sum, t) => sum + estMinutes(t.estimate), 0) },
      ...(due ? { dueToday: open.length } : {}),
    };
  });
}
