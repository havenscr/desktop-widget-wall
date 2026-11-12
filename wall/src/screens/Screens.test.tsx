import { render } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { usePlaceStore } from '../state/places';
import { Screens } from './Screens';

afterEach(() => usePlaceStore.setState({ active: 'work' }));

it('Home has no placeholder heading', () => {
  usePlaceStore.setState({ active: 'home' });
  const home = render(<Screens />);
  expect(home.container.querySelector('h1')).toBeNull();
});
