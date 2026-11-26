import { describe, expect, it } from 'vitest';
import { MORE_KEYS, SHELF_KEYS } from './ShelfPlace';
import { shelfKind } from './shelfKinds';

describe('shelf key kinds', () => {
  it('maps every Shelf key by id to the four colours', () => {
    const byId = Object.fromEntries([...SHELF_KEYS, ...MORE_KEYS].map((k) => [k.id, shelfKind(k.id)]));
    expect(byId).toEqual({
      'sx-region': 'capture',
      'sx-screen': 'capture',
      'sx-scrolling': 'capture',
      'sx-last-region': 'capture',
      'sx-record': 'agent',
      'sx-record-gif': 'agent',
      'sx-stop-record': 'agent',
      'sx-ocr': 'layout',
      'sx-color': 'layout',
      'sx-ruler': 'layout',
      'sx-pin': 'layout',
      'sx-highlighter': 'layout',
      'sx-history': 'app',
      'sx-folder': 'app',
    });
  });
  it('leaves an unknown key neutral', () => {
    expect(shelfKind('sx-other')).toBeUndefined();
  });
});
