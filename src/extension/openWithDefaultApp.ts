import { spawn, type SpawnOptions } from 'node:child_process';

export interface OpenCommand {
  command: string;
  args: string[];
  options: SpawnOptions;
}

const PATH_VARIABLE = 'OFFICE_VIEWER_FILE';

/**
 * Builds the platform command that opens a file with its default desktop app.
 *
 * On Windows the path travels through an environment variable so that characters
 * such as `&`, `^` or `,` in file names are never interpreted by cmd.exe.
 */
export function getOpenCommand(
  platform: NodeJS.Platform,
  filePath: string,
  env: NodeJS.ProcessEnv = process.env,
): OpenCommand {
  const base: SpawnOptions = { detached: true, stdio: 'ignore' };
  switch (platform) {
    case 'win32':
      return {
        command: env.ComSpec ?? 'cmd.exe',
        args: ['/d', '/s', '/c', `start "" "%${PATH_VARIABLE}%"`],
        options: {
          ...base,
          windowsHide: true,
          windowsVerbatimArguments: true,
          env: { ...env, [PATH_VARIABLE]: filePath },
        },
      };
    case 'darwin':
      return { command: 'open', args: [filePath], options: base };
    default:
      return { command: 'xdg-open', args: [filePath], options: base };
  }
}

export function openWithDefaultApp(filePath: string): Promise<void> {
  const { command, args, options } = getOpenCommand(process.platform, filePath);
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, options);
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}
