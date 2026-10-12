import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { gitObject, lfsObjectId } from './gitObject';

/** The part of the Git extension's API used here. */
interface GitApi {
  git: { path: string };
  getRepository(uri: vscode.Uri): { rootUri: vscode.Uri } | null;
}

interface GitExtension {
  getAPI(version: 1): GitApi;
}

/** Office files can be large; this only stops a runaway read. */
const MAX_BYTES = 1024 * 1024 * 1024;

/**
 * Reads a version of a file from Git as it was committed. VS Code's Git extension reads
 * versions with `git show --textconv`, so where a text conversion is set up for a file type,
 * as Git for Windows does for Word files (`diff=astextplain`), it hands over plain text
 * instead of the document; and for files in Git LFS it hands over the pointer. Returns
 * undefined when the version can't be read this way.
 */
export async function readGitBlob(uri: vscode.Uri): Promise<Uint8Array | undefined> {
  let query: { path?: unknown; ref?: unknown };
  try {
    query = JSON.parse(uri.query) as typeof query;
  } catch {
    return undefined;
  }
  if (typeof query.path !== 'string' || typeof query.ref !== 'string') return undefined;

  const extension = vscode.extensions.getExtension<GitExtension>('vscode.git');
  if (!extension) return undefined;
  const api = (extension.isActive ? extension.exports : await extension.activate()).getAPI(1);
  const file = vscode.Uri.file(query.path);
  const root = api.getRepository(file)?.rootUri.fsPath;
  if (!root) return undefined;
  const object = gitObject(query.ref, path.relative(root, file.fsPath).split(path.sep).join('/'));
  if (!object) return undefined;

  const blob = await git(api.git.path, root, ['show', object]);
  const oid = blob && lfsObjectId(blob);
  return oid ? ((await readLfsObject(api.git.path, root, oid)) ?? blob) : blob;
}

/**
 * Reads a Git LFS object from the local store, where checked-out versions are. Older ones
 * may only be on the server; those aren't downloaded, as Nightdocs doesn't use the network.
 */
async function readLfsObject(
  gitPath: string,
  root: string,
  oid: string,
): Promise<Uint8Array | undefined> {
  const gitDir = await git(gitPath, root, ['rev-parse', '--git-common-dir']);
  if (!gitDir) return undefined;
  const store = path.resolve(root, new TextDecoder().decode(gitDir).trim(), 'lfs', 'objects');
  try {
    return await readFile(path.join(store, oid.slice(0, 2), oid.slice(2, 4), oid));
  } catch {
    return undefined;
  }
}

function git(gitPath: string, cwd: string, args: string[]): Promise<Uint8Array | undefined> {
  return new Promise((resolve) => {
    execFile(
      gitPath,
      args,
      { cwd, encoding: 'buffer', maxBuffer: MAX_BYTES, windowsHide: true },
      (error, stdout) => resolve(error ? undefined : new Uint8Array(stdout)),
    );
  });
}
