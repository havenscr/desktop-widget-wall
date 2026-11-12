import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { Clock } from './Clock';

const fixed = () => new Date(2026, 10, 11, 10, 24, 10);

it('renders the injected time and date', () => {
  render(<Clock now={fixed} />);
  expect(screen.getByText('Wednesday, November 11')).toBeTruthy();
  expect(screen.getByLabelText('10:24 AM')).toBeTruthy();
});
