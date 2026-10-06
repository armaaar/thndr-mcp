import { describe, expect, it, vi } from 'vitest';

const spawn = vi.fn();
vi.mock('node:child_process', () => ({ spawn: (...args: unknown[]) => spawn(...args) }));

const { openCommand, openInBrowser } = await import('../open');

describe('openCommand', () => {
  const url = 'http://127.0.0.1:1234/token/';

  it.each([
    ['darwin', {}, ['open', [url]]],
    ['win32', {}, ['cmd', ['/c', 'start', '""', url]]],
    ['linux', { WSL_DISTRO_NAME: 'Ubuntu' }, ['explorer.exe', [url]]],
    ['linux', {}, ['xdg-open', [url]]],
  ] as const)('on %s %o uses %o', (platform, env, expected) => {
    expect(openCommand(url, platform, env)).toEqual(expected);
  });
});

describe('openInBrowser', () => {
  it('starts the opener detached, ignores a missing opener and does not wait for it', () => {
    const child = { on: vi.fn(), unref: vi.fn() };
    spawn.mockReturnValue(child);
    openInBrowser('http://127.0.0.1:1/t/');

    const [command, args, options] = spawn.mock.calls[0] ?? [];
    expect([command, args]).toEqual(openCommand('http://127.0.0.1:1/t/'));
    expect(options).toEqual({ detached: true, stdio: 'ignore' });
    expect(child.on).toHaveBeenCalledWith('error', expect.any(Function));
    const onError = child.on.mock.calls[0]?.[1] as () => void;
    expect(() => onError()).not.toThrow();
    expect(child.unref).toHaveBeenCalledOnce();
  });
});
