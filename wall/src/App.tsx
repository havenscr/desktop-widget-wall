import { useEffect } from 'react';
import { useFocusStore } from './focus/store';
import { HorizonCanvas } from './horizon/HorizonCanvas';
import { Rail } from './rail/Rail';
import { Clock } from './clock/Clock';
import { Screens } from './screens/Screens';
import { Stage } from './stage/Stage';

export function App() {
  // The focus timer lives for the whole app, not for the Work screen.
  useEffect(() => {
    useFocusStore.getState().init();
  }, []);

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
