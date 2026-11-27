import { beforeEach, describe, expect, it } from 'vitest';
import {
  addRecentSearch,
  clearRecentSearches,
  getCommentedVideoIds,
  getRecentSearches,
  markVideoCommented,
} from './profileActivity';

describe('profile activity storage', () => {
  beforeEach(() => localStorage.clear());

  it('records comments without duplicates', () => {
    markVideoCommented('video-1');
    markVideoCommented('video-1');
    markVideoCommented('video-2');
    expect(getCommentedVideoIds()).toEqual(['video-2', 'video-1']);
  });

  it('adds trimmed, de-duplicated recent searches', () => {
    addRecentSearch('  camera  ');
    addRecentSearch('Camera');
    addRecentSearch('');
    expect(getRecentSearches()).toEqual(['Camera']);
  });

  it('can clear recent searches', () => {
    addRecentSearch('camera');
    clearRecentSearches();
    expect(getRecentSearches()).toEqual([]);
  });
});
