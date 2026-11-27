import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { api, ApiError, SIGN_IN_REQUIRED_EVENT } from '../../lib/api';
import SignInDialog from './SignInDialog';

afterEach(() => vi.restoreAllMocks());

function stubFetch(status: number, body: unknown) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })));
}

describe('guests can browse; writes ask them to sign in', () => {
  it('a 401 SIGN_IN_REQUIRED raises the sign-in event and a typed error', async () => {
    stubFetch(401, { error: 'Sign in to continue', code: 'SIGN_IN_REQUIRED' });
    const seen = vi.fn();
    window.addEventListener(SIGN_IN_REQUIRED_EVENT, seen);
    const err = await api.like('v1').catch((e) => e);
    window.removeEventListener(SIGN_IN_REQUIRED_EVENT, seen);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe('SIGN_IN_REQUIRED');
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it('other errors (wrong password, server error) do not open the dialog', async () => {
    stubFetch(401, { error: 'Invalid email or password' });
    const seen = vi.fn();
    window.addEventListener(SIGN_IN_REQUIRED_EVENT, seen);
    await api.login('a@b.co', 'x').catch(() => {});
    stubFetch(500, { error: 'Internal server error' });
    await api.like('v1').catch(() => {});
    window.removeEventListener(SIGN_IN_REQUIRED_EVENT, seen);
    expect(seen).not.toHaveBeenCalled();
  });

  it('the partner API check failure keeps its issue list for the form to show', async () => {
    stubFetch(422, { error: 'Your listing API did not pass the connection check', code: 'API_CHECK_FAILED', check: { ok: false, ms: 5, issues: [{ level: 'error', message: 'listings[0].title must be a non-empty string' }] } });
    const err = (await api.applyAsPartner({ name: 'A', baseUrl: 'https://a.example.com', apiBase: 'https://api.a.example.com', contactEmail: 'a@a.example.com' }).catch((e) => e)) as ApiError;
    expect(err.code).toBe('API_CHECK_FAILED');
    expect(err.body.check.issues[0].message).toMatch(/title/);
  });

  it('SignInDialog stays hidden until the event, then shows the sign-in form and can be closed', async () => {
    render(<MemoryRouter><SignInDialog /></MemoryRouter>);
    expect(screen.queryByRole('dialog')).toBeNull();
    act(() => { window.dispatchEvent(new Event(SIGN_IN_REQUIRED_EVENT)); });
    expect(screen.getByRole('dialog')).toBeTruthy();
    act(() => { screen.getByLabelText(/close sign-in/i).click(); });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
