import { spawn } from 'node:child_process';

/** The command that opens `url` in the default browser, per platform (WSL uses the Windows browser). */
export function openCommand(
  url: string,
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): [string, string[]] {
  if (platform === 'darwin') return ['open', [url]];
  if (platform === 'win32') return ['rundll32', ['url.dll,FileProtocolHandler', url]];
  if (env.WSL_DISTRO_NAME) return ['explorer.exe', [url]];
  return ['xdg-open', [url]];
}

/** Opens `url` in the user's browser; resolves to whether that (as far as can be told) worked. */
export type OpenUrl = (url: string) => Promise<boolean>;

/** How long to wait for the opener to report a failure before assuming the browser is opening. */
const OPENER_GRACE_MS = 3_000;

/**
 * Opens `url` in the default browser. It fails when no opener exists or the opener reports an error; `explorer.exe`
 * always exits with 1, even when it opened the page, so under WSL only a missing opener counts as a failure.
 */
export const openInBrowser: OpenUrl = (url) =>
  new Promise((resolve) => {
    const [command, args] = openCommand(url);
    const child = spawn(command, args, { detached: true, stdio: 'ignore' });
    const timer = setTimeout(() => resolve(true), OPENER_GRACE_MS);
    timer.unref();
    const settle = (opened: boolean) => {
      clearTimeout(timer);
      resolve(opened);
    };
    child.on('error', () => settle(false));
    child.on('exit', (code) => settle(code === 0 || command === 'explorer.exe'));
    child.unref();
  });
