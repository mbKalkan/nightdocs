import { describe, expect, it } from 'vitest';
import { getOpenCommand } from '../../src/extension/openWithDefaultApp';

describe('getOpenCommand', () => {
  it('passes the path to cmd.exe through an environment variable on Windows', () => {
    const path = 'C:\\Docs\\Q3 & Q4, 100% ^final.docx';
    const { command, args, options } = getOpenCommand('win32', path, { ComSpec: 'C:\\cmd.exe' });
    expect(command).toBe('C:\\cmd.exe');
    expect(args.join(' ')).not.toContain(path);
    expect(args.at(-1)).toBe('start "" "%OFFICE_VIEWER_FILE%"');
    expect(options.env?.OFFICE_VIEWER_FILE).toBe(path);
    expect(options.windowsVerbatimArguments).toBe(true);
    expect(options.windowsHide).toBe(true);
  });

  it('uses open on macOS and xdg-open elsewhere', () => {
    expect(getOpenCommand('darwin', '/a b.docx')).toMatchObject({
      command: 'open',
      args: ['/a b.docx'],
    });
    expect(getOpenCommand('linux', '/a b.docx')).toMatchObject({
      command: 'xdg-open',
      args: ['/a b.docx'],
    });
  });

  it('detaches the child process', () => {
    expect(getOpenCommand('linux', '/a.docx').options).toMatchObject({
      detached: true,
      stdio: 'ignore',
    });
  });
});
