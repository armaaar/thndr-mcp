import { afterEach, describe, expect, it, vi } from 'vitest';

const spawn = vi.fn();
vi.mock('node:child_process', () => ({ spawn: (...args: unknown[]) => spawn(...args) }));

const { openCommand, openInBrowser } = await import('../open');

describe('openCommand', () => {
  const url = 'http://127.0.0.1:1234/token/';

  it.each([
    ['darwin', {}, ['open', [url]]],
    ['win32', {}, ['rundll32', ['url.dll,FileProtocolHandler', url]]],
    ['linux', { WSL_DISTRO_NAME: 'Ubuntu' }, ['explorer.exe', [url]]],
    ['linux', {}, ['xdg-open', [url]]],
  ] as const)('on %s %o uses %o', (platform, env, expected) => {
    expect(openCommand(url, platform, env)).toEqual(expected);
  });
});

describe('openInBrowser', () => {
  type Handler = (arg?: unknown) => void;
  const child = () => {
    const handlers: Record<string, Handler> = {};
    return { handlers, on: vi.fn((event: string, h: Handler) => (handlers[event] = h)), unref: vi.fn() };
  };
  const original = process.env.WSL_DISTRO_NAME;
  afterEach(() => {
    if (original === undefined) delete process.env.WSL_DISTRO_NAME;
    else process.env.WSL_DISTRO_NAME = original;
    vi.useRealTimers();
  });

  it('starts the opener detached and does not keep the process alive', async () => {
    const c = child();
    spawn.mockReturnValue(c);
    const opened = openInBrowser('http://127.0.0.1:1/t/');
    c.handlers.exit?.(0);

    expect(await opened).toBe(true);
    const [command, args, options] = spawn.mock.calls.at(-1) ?? [];
    expect([command, args]).toEqual(openCommand('http://127.0.0.1:1/t/'));
    expect(options).toEqual({ detached: true, stdio: 'ignore' });
    expect(c.unref).toHaveBeenCalledOnce();
  });

  it('fails when the opener is missing or reports an error', async () => {
    process.env.WSL_DISTRO_NAME = '';
    const missing = child();
    spawn.mockReturnValue(missing);
    const a = openInBrowser('http://x/');
    missing.handlers.error?.(new Error('ENOENT'));
    expect(await a).toBe(false);

    const failing = child();
    spawn.mockReturnValue(failing);
    const b = openInBrowser('http://x/');
    failing.handlers.exit?.(3);
    expect(await b).toBe(false);
  });

  it('trusts explorer.exe under WSL, which exits with 1 even when it opened the page', async () => {
    if (process.platform !== 'linux') return;
    process.env.WSL_DISTRO_NAME = 'Ubuntu';
    const c = child();
    spawn.mockReturnValue(c);
    const opened = openInBrowser('http://x/');
    c.handlers.exit?.(1);
    expect(await opened).toBe(true);
  });

  it('assumes the browser is opening when the opener is still running after a grace period', async () => {
    vi.useFakeTimers();
    const c = child();
    spawn.mockReturnValue(c);
    const opened = openInBrowser('http://x/');
    vi.advanceTimersByTime(3_000);
    expect(await opened).toBe(true);
  });
});
