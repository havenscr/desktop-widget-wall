import { render } from '@testing-library/react';
import { expect, test } from 'vitest';
import { NameButton, TileLevel, TileSwitch } from './GroupTile';

test('a tile reads name first, switch last, with the level bar after them', () => {
  const { container } = render(
    <div className="st-tg on">
      <NameButton id="keys" label="Key lights" />
      <TileSwitch label="Key lights" on onClick={() => {}} />
      <TileLevel level={45} colour="#ffe7c7" />
    </div>,
  );
  const kids = [...(container.firstElementChild as HTMLElement).children].map((e) => e.className);
  expect(kids[0]).toContain('st-name');
  expect(kids[1]).toContain('st-tg-sw');
  expect(kids[2]).toBe('st-track');
  expect(kids[3]).toBe('st-bar');
  expect((container.querySelector('.st-bar') as HTMLElement).style.width).toContain('45%');
});

test('with no level known only the track is drawn', () => {
  const { container } = render(<TileLevel level={null} colour="#fff" />);
  expect(container.querySelector('.st-track')).toBeTruthy();
  expect(container.querySelector('.st-bar')).toBeNull();
});
