import { afterEach, describe, expect, it, vi } from 'vitest';
import { isAdmin } from './api';
import { safeNext } from './next';
import { isOnboarded, markOnboarded } from './onboarding';
import { safeUrl } from './safe-url';
import { applyTheme, readTheme } from './theme';

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('safeUrl', () => {
  it('allows only http(s)', () => {
    expect(safeUrl('https://example.com/a')).toBe('https://example.com/a');
    expect(safeUrl('javascript:alert(1)')).toBeUndefined();
    expect(safeUrl('data:text/html,hi')).toBeUndefined();
    expect(safeUrl('not a url')).toBeUndefined();
  });
});

describe('safeNext (no open redirects after sign-in)', () => {
  it('accepts same-site paths only', () => {
    expect(safeNext('/invite/abc')).toBe('/invite/abc');
    expect(safeNext('https://evil.example')).toBeNull();
    expect(safeNext('//evil.example')).toBeNull();
    expect(safeNext(null)).toBeNull();
  });
});

describe('theme', () => {
  it('reads the saved theme and defaults to system', () => {
    expect(readTheme()).toBe('system');
    localStorage.setItem('findr.theme', 'dark');
    expect(readTheme()).toBe('dark');
  });

  it('falls back to system when storage is unavailable', () => {
    localStorage.setItem('findr.theme', 'dark');
    const spy = vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(readTheme()).toBe('system');
    spy.mockRestore();
  });

  it('puts .dark on <html> for the dark theme', () => {
    applyTheme('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    applyTheme('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });
});

describe('onboarding flag', () => {
  it('is remembered per workspace, and never blocks when storage fails', () => {
    expect(isOnboarded('ws1')).toBe(false);
    markOnboarded('ws1');
    expect(isOnboarded('ws1')).toBe(true);
    expect(isOnboarded('ws2')).toBe(false);
    const spy = vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(isOnboarded('ws2')).toBe(true);
    spy.mockRestore();
  });
});

describe('roles', () => {
  it('owners and admins get admin pages; members do not', () => {
    expect(isAdmin('owner')).toBe(true);
    expect(isAdmin('admin')).toBe(true);
    expect(isAdmin('member')).toBe(false);
  });
});
