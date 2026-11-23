import { describe, expect, it } from 'vitest';
import { mediaUrl, piitradeUrl } from './config';

describe('frontend URL helpers', () => {
  it('passes absolute media URLs through unchanged', () => {
    expect(mediaUrl('https://cdn.example.com/video.mp4')).toBe('https://cdn.example.com/video.mp4');
  });

  it('handles missing media paths', () => {
    expect(mediaUrl(null)).toBeUndefined();
  });

  it('adds attribution parameters to marketplace links', () => {
    const url = new URL(piitradeUrl('/cars/123'));
    expect(url.pathname).toBe('/cars/123');
    expect(url.searchParams.get('utm_source')).toBe('piitrade_videos');
    expect(url.searchParams.get('utm_medium')).toBe('video');
  });
});
