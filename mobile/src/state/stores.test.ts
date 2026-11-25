import { beforeEach, describe, expect, it, vi } from 'vitest';

const storage = vi.hoisted(() => ({
  getItem: vi.fn(),
  setItem: vi.fn(),
}));

vi.mock('@react-native-async-storage/async-storage', () => ({ default: storage }));
vi.mock('../api', () => ({ api: {} }));

import { addRecentSearch, getRecentSearches } from './stores';

describe('recent searches', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('ignores malformed stored data when adding a search', async () => {
    storage.getItem.mockResolvedValue('{"not":"a list"}');
    storage.setItem.mockResolvedValue(undefined);

    expect(await getRecentSearches()).toEqual([]);
    await addRecentSearch('boots');

    expect(storage.setItem).toHaveBeenCalledWith('piitrade_recent_searches', '["boots"]');
  });

  it('filters non-string values from stored search history', async () => {
    storage.getItem.mockResolvedValue('["boots", null, 42]');

    expect(await getRecentSearches()).toEqual(['boots']);
  });
});
