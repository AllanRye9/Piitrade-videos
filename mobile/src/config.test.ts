import { describe, expect, it } from 'vitest';
import { API_BASE, MAX_VIDEO_SECONDS, NUDGE, WEB_URL, mediaUrl, piitradeUrl } from './config';

describe('mobile app configuration', () => {
  it('uses the published 60-second video limit', () => {
    expect(MAX_VIDEO_SECONDS).toBe(60);
  });

  it('talks to the production host unless a build overrides it', () => {
    expect(API_BASE).toBe(process.env.EXPO_PUBLIC_API_BASE_URL ? API_BASE : 'https://v.piitrade.com');
    expect(API_BASE).not.toMatch(/yotweek/);
    expect(WEB_URL).not.toMatch(/yotweek/);
  });

  it('resolves backend-relative media paths against the API host', () => {
    expect(mediaUrl('/uploads/videos/a.mp4')).toBe(`${API_BASE}/uploads/videos/a.mp4`);
    expect(mediaUrl('uploads/posters/a.jpg')).toBe(`${API_BASE}/uploads/posters/a.jpg`);
    expect(mediaUrl('')).toBeUndefined();
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
