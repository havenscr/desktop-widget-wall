import { mocks } from '../tauri';

type Est = '15' | '30' | '45' | '60plus' | null;
interface MockTask {
  id: string;
  title: string;
  /** Days from today. */
  due: number;
  allDay: boolean;
  hour: number;
  est: Est;
  list: string;
}

const pad = (n: number) => String(n).padStart(2, '0');
const day = (n: number) => {
  const d = new Date();
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
    est: t.est,
  };
}

const estMinutes = (e: Est) => (e === '60plus' ? 60 : e ? Number(e) : 0);

/** The task card, plus the summary the Work and Home screens read. */
export function registerTaskMocks(): void {
  let tasks: MockTask[] = [
    { id: 't1', title: 'Send the project proposal', due: 0, allDay: false, hour: 15, est: '45', list: 'Work' },
    { id: 't2', title: 'Review the dashboard draft', due: 1, allDay: true, hour: 0, est: '30', list: 'Work' },
    { id: 't3', title: 'Order printer paper', due: 4, allDay: true, hour: 0, est: '15', list: 'Home' },
    { id: 't4', title: 'Book a dentist visit', due: 9, allDay: true, hour: 0, est: null, list: 'Home' },
    { id: 't5', title: 'Fix the garage door', due: 1, allDay: true, hour: 0, est: '60plus', list: 'Home' },
    { id: 't6', title: 'Water the plants', due: 2, allDay: true, hour: 0, est: '15', list: 'Home' },
    { id: 't7', title: 'Sort the recycling', due: 6, allDay: true, hour: 0, est: '15', list: 'Home' },
    { id: 't8', title: 'Renew the car registration', due: 12, allDay: true, hour: 0, est: '30', list: 'Home' },
  ];
  mocks.set('wall2_tasks_next', () => tasks.slice(0, 3).map(toItem));
  mocks.set('wall2_task_done', (args) => {
    tasks = tasks.filter((t) => t.id !== args?.id);
  });
  mocks.set('wall2_tasks_summary', (args) => {
    const list = typeof args?.list === 'string' ? args.list.toLowerCase() : null;
    const open = tasks.filter((t) => list === null || t.list.toLowerCase() === list);
    const tomorrow = open.filter((t) => t.due === 1);
    return {
      next: open.slice(0, 3).map(toItem),
      remaining: Math.max(0, open.length - 3),
      dueTomorrow: { count: tomorrow.length, estMinutes: tomorrow.reduce((sum, t) => sum + estMinutes(t.est), 0) },
    };
  });
}
