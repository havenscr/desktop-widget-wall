import { HorizonCanvas } from './horizon/HorizonCanvas';
import { Rail } from './rail/Rail';
import { Clock } from './clock/Clock';
import { Screens } from './screens/Screens';
import { Stage } from './stage/Stage';

export function App() {
  return (
    <Stage>
      <HorizonCanvas />
      <div className="shell">
        <Rail />
        <div className="main">
          <Clock />
          <Screens />
        </div>
      </div>
    </Stage>
  );
}
