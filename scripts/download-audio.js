/**
 * Phase 2: Local audio download cron.
 *
 * Polls Supabase for podcasts with status "audio_ready",
 * downloads audio via the NotebookLM MCP CLI (nlm),
 * uploads to Supabase Storage, and sets status to "ready".
 *
 * Runs locally on your Mac every 5 minutes via launchd.
 * Requires: nlm CLI authenticated (nlm login).
 */

import { createClient } from '@supabase/supabase-js';
import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

const SUPABASE_URL = 'https://yifhgbpzdaphdkxpnydy.supabase.co';
const SUPABASE_SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlpZmhnYnB6ZGFwaGRreHBueWR5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MjU3MDY1MSwiZXhwIjoyMDg4MTQ2NjUxfQ.9hcMgdfqQlK8SJ3j_qF2aoRT89s3r1ut8M33TR48RQ4';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function main() {
  // Find podcasts waiting for audio download
  const { data: pending, error } = await supabase
    .from('podcasts')
    .select('id, notebook_id')
    .eq('status', 'audio_ready');

  if (error) {
    console.error('Failed to query podcasts:', error);
    process.exit(1);
  }

  if (!pending || pending.length === 0) {
    console.log('No podcasts waiting for download.');
    return;
  }

  console.log(`Found ${pending.length} podcast(s) to download.`);

  for (const podcast of pending) {
    try {
      console.log(`Downloading audio for podcast ${podcast.id} (notebook: ${podcast.notebook_id})...`);

      const outputPath = `/tmp/podcast-${podcast.id}.m4a`;

      // Use nlm CLI to download (it has proper Google auth via Chrome profile)
      await exec('nlm', [
        'download', 'audio',
        '--notebook', podcast.notebook_id,
        '--output', outputPath,
      ], { timeout: 120000 });

      const audioBuffer = await readFile(outputPath);
      console.log(`Downloaded: ${audioBuffer.length} bytes`);

      // Verify it's real audio (not HTML)
      if (audioBuffer.slice(0, 15).toString().includes('<!doctype')) {
        throw new Error('Downloaded HTML instead of audio — nlm auth may have expired');
      }

      // Upload to Supabase Storage
      const storagePath = `${podcast.id}.m4a`;
      const { error: uploadErr } = await supabase.storage
        .from('podcast-audio')
        .upload(storagePath, audioBuffer, { contentType: 'audio/mp4', upsert: true });

      if (uploadErr) throw new Error(`Upload failed: ${uploadErr.message}`);

      const { data: urlData } = supabase.storage
        .from('podcast-audio')
        .getPublicUrl(storagePath);

      // Mark as ready
      await supabase.from('podcasts').update({
        audio_url: urlData.publicUrl,
        status: 'ready',
      }).eq('id', podcast.id);

      console.log(`Podcast ${podcast.id} is ready: ${urlData.publicUrl}`);
    } catch (err) {
      console.error(`Failed to download podcast ${podcast.id}:`, err.message);
      await supabase.from('podcasts').update({
        status: 'failed',
        error_message: `Audio download failed: ${err.message}`,
      }).eq('id', podcast.id);
    }
  }
}

main();
