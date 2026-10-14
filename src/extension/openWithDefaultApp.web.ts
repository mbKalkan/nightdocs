/**
 * Stand-in for `openWithDefaultApp.ts` in the web bundle (see scripts/build.mjs). A browser
 * can't hand a file to a desktop app; the viewer never offers to on the web, so this is only
 * reached if a command is run by hand.
 */
export function openWithDefaultApp(filePath: string): Promise<void> {
  return Promise.reject(new Error(`No desktop application can open ${filePath} from the browser.`));
}
