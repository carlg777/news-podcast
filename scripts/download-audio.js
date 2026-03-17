/**
 * Phase 2: Local audio download cron.
 *
 * Polls Supabase for podcasts with status "audio_ready",
 * downloads audio via the NotebookLM MCP CLI (nlm),
 * uploads to Supabase Storage, and sets status to "ready".
 *
 * Runs locally on your Mac every 5 minutes via launchd.
 * Requires: nlm CLI authenticated (nlm login).
 *
 * Uses pipeline-runner for per-step timeout, retry, and structured logging.
 * Cross-invocation retry logic (retry_count in Supabase) is preserved
 * outside the runner — max 6 retries across launchd invocations (30 min window).
 */

import { createClient } from "@supabase/supabase-js";
import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import os from "node:os";
import { pathToFileURL } from "node:url";

const { runPipeline } = await import(
  pathToFileURL(
    path.join(os.homedir(), ".carl/pipeline-runner/pipeline-runner.js"),
  ).href
);

const exec = promisify(execFile);

const SUPABASE_URL = "https://yifhgbpzdaphdkxpnydy.supabase.co";
const SUPABASE_SERVICE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlpZmhnYnB6ZGFwaGRreHBueWR5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MjU3MDY1MSwiZXhwIjoyMDg4MTQ2NjUxfQ.9hcMgdfqQlK8SJ3j_qF2aoRT89s3r1ut8M33TR48RQ4";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function main() {
  // Find podcasts waiting for audio download
  const { data: pending, error } = await supabase
    .from("podcasts")
    .select("id, notebook_id, retry_count")
    .eq("status", "audio_ready");

  if (error) {
    console.error("Failed to query podcasts:", error);
    process.exit(1);
  }

  if (!pending || pending.length === 0) {
    console.log("No podcasts waiting for download.");
    return;
  }

  console.log(`Found ${pending.length} podcast(s) to download.`);

  for (const podcast of pending) {
    console.log(
      `Downloading audio for podcast ${podcast.id} (notebook: ${podcast.notebook_id})...`,
    );

    const outputPath = `/tmp/podcast-${podcast.id}.m4a`;
    const nlmPath =
      process.env.NLM_PATH || `${process.env.HOME}/.local/bin/nlm`;

    const steps = [
      {
        name: "download-audio",
        type: "file",
        fn: async (ctx) => {
          await exec(
            nlmPath,
            [
              "download",
              "audio",
              podcast.notebook_id,
              "-o",
              outputPath,
              "--no-progress",
            ],
            { timeout: 120000 },
          );

          ctx.audioBuffer = await readFile(outputPath);
          console.log(`Downloaded: ${ctx.audioBuffer.length} bytes`);
        },
      },
      {
        name: "validate-audio",
        type: "api",
        fn: async (ctx) => {
          if (ctx.audioBuffer.slice(0, 15).toString().includes("<!doctype")) {
            throw new Error(
              "Downloaded HTML instead of audio — nlm auth may have expired",
            );
          }
        },
      },
      {
        name: "upload-to-supabase",
        type: "api",
        fn: async (ctx) => {
          const storagePath = `${podcast.id}.m4a`;
          const { error: uploadErr } = await supabase.storage
            .from("podcast-audio")
            .upload(storagePath, ctx.audioBuffer, {
              contentType: "audio/mp4",
              upsert: true,
            });

          if (uploadErr) throw new Error(`Upload failed: ${uploadErr.message}`);

          const { data: urlData } = supabase.storage
            .from("podcast-audio")
            .getPublicUrl(storagePath);

          ctx.publicUrl = urlData.publicUrl;
        },
      },
      {
        name: "mark-ready",
        type: "api",
        fn: async (ctx) => {
          await supabase
            .from("podcasts")
            .update({
              audio_url: ctx.publicUrl,
              status: "ready",
            })
            .eq("id", podcast.id);

          console.log(`Podcast ${podcast.id} is ready: ${ctx.publicUrl}`);
        },
      },
    ];

    const result = await runPipeline(`download-audio-${podcast.id}`, steps);

    // Cross-invocation retry logic (outside the runner)
    if (!result.success) {
      const retries = (podcast.retry_count || 0) + 1;
      const maxRetries = 6; // 6 retries × 5 min = 30 min window
      console.error(
        `Failed to download podcast ${podcast.id} (attempt ${retries}/${maxRetries}):`,
        result.error,
      );

      if (retries >= maxRetries) {
        await supabase
          .from("podcasts")
          .update({
            status: "failed",
            error_message: `Audio download failed after ${retries} attempts: ${result.error}`,
            retry_count: retries,
          })
          .eq("id", podcast.id);
      } else {
        // Keep as audio_ready so the next cron cycle retries
        await supabase
          .from("podcasts")
          .update({
            retry_count: retries,
            error_message: `Retry ${retries}/${maxRetries}: ${result.error}`,
          })
          .eq("id", podcast.id);
        console.log(`Will retry on next cycle (${retries}/${maxRetries}).`);
      }
    }
  }
}

main();
