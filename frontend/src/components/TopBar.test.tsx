import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import TopBar from './TopBar';

const profileSnapshot = vi.hoisted(() => ({
  avatar: null,
  displayName: null,
  handle: null,
  bio: null,
  loaded: true,
}));

vi.mock('../features/account/profileStore', () => ({
  ensureProfileLoaded: vi.fn(),
  getProfileState: () => profileSnapshot,
  subscribeProfile: () => () => {},
}));

function renderTopBar(overrides: Partial<React.ComponentProps<typeof TopBar>> = {}) {
  const props: React.ComponentProps<typeof TopBar> = {
    mode: 'latest',
    onModeChange: vi.fn(),
    onSearch: vi.fn(),
    onUploadClick: vi.fn(),
    onSettingsClick: vi.fn(),
    onNotificationsClick: vi.fn(),
    unreadCount: 0,
    ...overrides,
  };
  render(
    <MemoryRouter>
      <TopBar {...props} />
    </MemoryRouter>,
  );
  return props;
}

describe('TopBar', () => {
  it('switches feed modes', () => {
    const props = renderTopBar();
    fireEvent.click(screen.getByRole('tab', { name: 'Trending' }));
    expect(props.onModeChange).toHaveBeenCalledWith('trending');
  });

  it('opens search and debounces search input', async () => {
    vi.useFakeTimers();
    const props = renderTopBar();
    fireEvent.click(screen.getByRole('button', { name: 'Search videos' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Search videos' }), { target: { value: '  camera  ' } });
    await vi.advanceTimersByTimeAsync(300);
    expect(props.onSearch).toHaveBeenCalledWith('camera');
    vi.useRealTimers();
  });

  it('opens upload and shows the unread notification badge', () => {
    const props = renderTopBar({ unreadCount: 12 });
    fireEvent.click(screen.getByRole('button', { name: 'Upload a video' }));
    expect(props.onUploadClick).toHaveBeenCalledOnce();
    expect(screen.getByLabelText('Account menu, 12 unread notifications')).toBeInTheDocument();
  });
});
