import './styles/tokens.css';
import './styles/app.css';
import './styles/frame.css';
import './styles/work.css';
import './styles/home.css';
import './styles/meet.css';
import './styles/ribbon.css';
import './styles/agents.css';
import './styles/unwind.css';
import './styles/zen.css';
import './styles/signals.css';
import './styles/tools.css';
import './styles/onair.css';
import { startIfTop } from './ui/topWindow';

// The wall never runs inside a frame (content in a player frame could otherwise load it there
// with full command access). Everything that installs a listener or calls a command lives in
// `boot.tsx`, which is imported only when this is the top window.
startIfTop(window, () => import('./boot'));
