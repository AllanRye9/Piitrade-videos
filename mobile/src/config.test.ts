import { describe, expect, it } from 'vitest';
import { MAX_VIDEO_SECONDS, NUDGE, mediaUrl, piitradeUrl } from './config';

describe('mobile app configuration', () => {
  it('uses the published 60-second video limit', () => {
    expect(MAX_VIDEO_SECONDS).toBe(60);
  });

  it('passes absolute media URLs through unchanged', () => {
    expect(mediaUrl('https://cdn.example.com/video.mp4')).toBe('https://cdn.example.com/video.mp4');
  });

  it('adds app-attribution parameters to Piitrade URLs', () => {
    const url = new URL(piitradeUrl('/marketplace'));
    expect(url.searchParams.get('utm_source')).toBe('piitrade_videos_app');
    expect(url.searchParams.get('utm_medium')).toBe('video');
  });

  it('defines bounded guest sign-in nudges', () => {
    expect(NUDGE.firstAfterSeconds).toBe(20);
    expect(NUDGE.maxPerSession).toBe(5);
    expect(NUDGE.autoHideSeconds).toBe(12);
  });
});
