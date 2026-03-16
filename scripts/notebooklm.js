import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';

const exec = promisify(execFile);

async function nlm(args) {
  try {
    const { stdout } = await exec('npx', ['nlm', ...args], {
      timeout: 120000,
      env: { ...process.env },
    });
    try { return JSON.parse(stdout.trim()); }
    catch { return stdout.trim(); }
  } catch (err) {
    console.error(`nlm ${args.join(' ')} failed:`, err.stderr || err.message);
    throw new Error(`nlm command failed: ${args[0]} — ${err.message}`);
  }
}

export async function refreshAuth() {
  console.log('Refreshing NotebookLM auth...');
  await nlm(['login', 'refresh']);
}

export async function createNotebook(title) {
  console.log(`Creating notebook: ${title}`);
  const result = await nlm(['notebook', 'create', '--title', title, '--json']);
  return result.id || result.notebookId || result;
}

export async function addSource(notebookId, url) {
  console.log(`Adding source: ${url}`);
  await nlm(['source', 'add', '--notebook', notebookId, '--type', 'url', '--url', url, '--json']);
}

export async function generateAudio(notebookId) {
  console.log('Starting audio generation...');
  const result = await nlm(['studio', 'create', '--notebook', notebookId, '--type', 'audio', '--json']);
  const studioId = result.id || result.studioId || result;

  let attempts = 0;
  const maxAttempts = 40;
  while (attempts < maxAttempts) {
    await new Promise(resolve => setTimeout(resolve, 15000));
    attempts++;
    const status = await nlm(['studio', 'status', '--notebook', notebookId, '--json']);
    console.log(`Audio generation status (attempt ${attempts}): ${status.status || JSON.stringify(status)}`);
    if (status.status === 'completed' || status.status === 'ready') return studioId;
    if (status.status === 'failed' || status.status === 'error') {
      throw new Error(`Audio generation failed: ${status.error || 'Unknown error'}`);
    }
  }
  throw new Error('Audio generation timed out after 10 minutes');
}

export async function downloadAudio(notebookId) {
  const outputPath = path.join('/tmp', `podcast-${Date.now()}.mp3`);
  console.log(`Downloading audio to ${outputPath}...`);
  await nlm(['studio', 'download', '--notebook', notebookId, '--type', 'audio', '--output', outputPath]);
  return outputPath;
}

export async function deleteNotebook(notebookId) {
  console.log(`Deleting notebook: ${notebookId}`);
  try {
    await nlm(['notebook', 'delete', '--id', notebookId, '--confirm', '--json']);
  } catch (err) {
    console.warn(`Failed to delete notebook ${notebookId}:`, err.message);
  }
}
