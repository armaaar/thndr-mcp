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

export type OpenUrl = (url: string) => void;

/** Opens `url` in the default browser without waiting; if no opener exists, the caller still shows the URL. */
export const openInBrowser: OpenUrl = (url) => {
  const [command, args] = openCommand(url);
  const child = spawn(command, args, { detached: true, stdio: 'ignore' });
  child.on('error', () => undefined);
  child.unref();
};
