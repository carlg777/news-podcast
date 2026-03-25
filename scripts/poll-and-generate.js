/**
 * Poll-and-Generate: Single-run script for the full podcast pipeline.
 *
 * Queries Supabase for podcasts with status "generating",
 * runs the entire pipeline (fetch articles → nlm CLI → upload audio),
 * and marks the podcast as "ready".
 *
 * Runs locally on the Desktop Mac every 60s via launchd.
 * Replaces both GitHub Actions (Phase 1) and download-audio.js (Phase 2).
 *
 * Requires:
 *   - nlm CLI authenticated (nlm login)
 *   - ANTHROPIC_API_KEY env var (for custom query cleanup)
 *   - Node.js with project dependencies installed
 */

import { createClient } from "@supabase/supabase-js";
import { readFile, unlink } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import os from "node:os";
import { pathToFileURL, fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const { runPipeline } = await import(
  pathToFileURL(
    path.join(os.homedir(), ".carl/pipeline-runner/pipeline-runner.js"),
  ).href
);

const execFileAsync = promisify(execFile);

const SUPABASE_URL = "https://yifhgbpzdaphdkxpnydy.supabase.co";
const SUPABASE_SERVICE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlpZmhnYnB6ZGFwaGRreHBueWR5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MjU3MDY1MSwiZXhwIjoyMDg4MTQ2NjUxfQ.9hcMgdfqQlK8SJ3j_qF2aoRT89s3r1ut8M33TR48RQ4";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const nlmPath =
  process.env.NLM_PATH || path.join(os.homedir(), ".local/bin/nlm");

async function updatePodcast(podcastId, updates) {
  const { error } = await supabase
    .from("podcasts")
    .update(updates)
    .eq("id", podcastId);
  if (error) console.error("Failed to update podcast:", error);
}

async function nlm(args, opts = {}) {
  const { stdout, stderr } = await execFileAsync(nlmPath, args, {
    timeout: opts.timeout || 60000,
    env: { ...process.env, PATH: process.env.PATH },
  });
  if (stderr) console.warn("nlm stderr:", stderr);
  return stdout;
}

async function cleanupOldPodcasts() {
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const { data: oldPodcasts, error } = await supabase
    .from("podcasts")
    .select("id, notebook_id, audio_url")
    .lt("created_at", sevenDaysAgo.toISOString());

  if (error || !oldPodcasts || oldPodcasts.length === 0) return;

  console.log(`Cleaning up ${oldPodcasts.length} old podcasts...`);

  for (const podcast of oldPodcasts) {
    try {
      await supabase.storage
        .from("podcast-audio")
        .remove([`${podcast.id}.m4a`]);
    } catch (err) {
      console.warn(`Failed to delete audio for ${podcast.id}:`, err.message);
    }
    // Delete the notebook via nlm if we have an ID
    if (podcast.notebook_id) {
      try {
        await nlm(["notebook", "delete", podcast.notebook_id, "--confirm"], {
          timeout: 30000,
        });
      } catch (err) {
        console.warn(
          `Failed to delete notebook ${podcast.notebook_id}:`,
          err.message,
        );
      }
    }
    await supabase.from("podcasts").delete().eq("id", podcast.id);
  }
}

async function processPodcast(podcast) {
  const {
    id,
    topics,
    custom_query: customQuery,
    article_count: articleCount,
  } = podcast;

  console.log(
    `Pipeline started for podcast ${id}, topics: ${(topics || []).join(", ")}`,
  );

  const steps = [
    {
      name: "fetch-articles",
      type: "api",
      fn: async (ctx) => {
        // Dynamic imports for ES module siblings
        const { fetchArticlesForTopic } = await import(
          pathToFileURL(path.join(__dirname, "rss-feeds.js")).href
        );
        const { cleanCustomQuery, searchGoogleNews } = await import(
          pathToFileURL(path.join(__dirname, "custom-query.js")).href
        );

        let allArticles = [];
        const topicList = topics || ["ai"];
        const count = articleCount || 8;

        for (const topic of topicList) {
          if (topic === "custom" && customQuery) {
            console.log(`Cleaning custom query: "${customQuery}"`);
            const cleaned = await cleanCustomQuery(customQuery);
            console.log(`Cleaned queries: ${JSON.stringify(cleaned)}`);
            const customArticles = await searchGoogleNews(cleaned, count);
            allArticles.push(...customArticles);
          } else if (topic !== "custom") {
            const topicArticles = await fetchArticlesForTopic(topic, count);
            allArticles.push(...topicArticles);
          }
        }

        // Deduplicate by URL
        const seen = new Set();
        allArticles = allArticles.filter((a) => {
          if (seen.has(a.url)) return false;
          seen.add(a.url);
          return true;
        });

        if (allArticles.length === 0)
          throw new Error("No articles found for the selected topics");

        console.log(`Collected ${allArticles.length} unique articles`);

        await updatePodcast(id, {
          articles: allArticles,
          article_count: allArticles.length,
        });
        ctx.articles = allArticles;
      },
    },
    {
      name: "create-notebook",
      type: "nlm",
      fn: async (ctx) => {
        const today = new Date().toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        });
        const notebookTitle = `News Podcast — ${today}`;

        const output = await nlm(["notebook", "create", notebookTitle]);
        console.log("nlm notebook create output:", output.trim());

        // Try to extract notebook ID from output
        let notebookId = null;

        // Look for a UUID-like pattern or hash ID in the output
        const idMatch = output.match(
          /([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i,
        );
        if (idMatch) {
          notebookId = idMatch[1];
        }

        // Fallback: list notebooks and find the most recent one
        if (!notebookId) {
          console.log(
            "Could not parse notebook ID from output, listing notebooks...",
          );
          const listOutput = await nlm(["notebook", "list", "--json"]);
          const notebooks = JSON.parse(listOutput);
          if (Array.isArray(notebooks) && notebooks.length > 0) {
            // Sort by creation time desc and pick the first
            const sorted = notebooks.sort(
              (a, b) =>
                new Date(b.createdTime || b.created_at || 0) -
                new Date(a.createdTime || a.created_at || 0),
            );
            notebookId = sorted[0].id || sorted[0].notebookId;
          }
        }

        if (!notebookId)
          throw new Error("Failed to get notebook ID after creation");

        console.log(`Created notebook: ${notebookId}`);
        await updatePodcast(id, { notebook_id: notebookId });
        ctx.notebookId = notebookId;
      },
    },
    {
      name: "add-sources",
      type: "nlm",
      timeout: 300000,
      continueOnFail: true,
      fn: async (ctx) => {
        let addedCount = 0;

        for (const article of ctx.articles) {
          try {
            const isYouTube =
              article.url.includes("youtube.com") ||
              article.url.includes("youtu.be");
            const sourceFlag = isYouTube ? "--youtube" : "--url";

            await nlm(
              ["source", "add", ctx.notebookId, sourceFlag, article.url],
              { timeout: 30000 },
            );
            addedCount++;
            console.log(`Added source: ${article.title}`);
          } catch (err) {
            console.warn(`Failed to add source ${article.url}:`, err.message);
          }

          // Delay between sources to avoid rate limiting
          await new Promise((r) => setTimeout(r, 3000));
        }

        console.log(
          `Added ${addedCount} sources of ${ctx.articles.length} articles`,
        );

        if (addedCount === 0) {
          throw new Error("No sources added — cannot generate audio");
        }
      },
    },
    {
      name: "generate-audio",
      type: "nlm",
      fn: async (ctx) => {
        // Wait for NotebookLM to finish indexing sources
        console.log("Waiting 15s for sources to index...");
        await new Promise((r) => setTimeout(r, 15000));

        const output = await nlm(
          [
            "audio",
            "create",
            ctx.notebookId,
            "--confirm",
            "--format",
            "deep_dive",
          ],
          { timeout: 120000 },
        );
        console.log("Audio generation started:", output.trim());
      },
    },
    {
      name: "wait-for-audio",
      type: "nlm-longpoll",
      timeout: 660000, // 11 min overall timeout
      fn: async (ctx) => {
        const maxAttempts = 40;
        const pollInterval = 15000; // 15s

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
          console.log(`Polling audio status (${attempt}/${maxAttempts})...`);

          try {
            const output = await nlm(
              ["studio", "status", ctx.notebookId, "--json"],
              { timeout: 30000 },
            );

            const status = JSON.parse(output);

            // Check if audio artifact is complete
            // The status structure may vary; check common patterns
            const audioStatus =
              status.audio?.status ||
              status.status ||
              (Array.isArray(status)
                ? status.find(
                    (s) => s.type === "audio" || s.type === "deep_dive",
                  )?.status
                : null);

            if (
              audioStatus === "complete" ||
              audioStatus === "completed" ||
              audioStatus === "ready" ||
              audioStatus === "unknown"
            ) {
              // "unknown" = nlm CLI doesn't map this NLM status code,
              // but MCP confirms it means "completed". Treat it as done.
              console.log(
                `Audio generation complete! (status: ${audioStatus})`,
              );
              return;
            }

            if (audioStatus === "failed" || audioStatus === "error") {
              throw new Error(
                `Audio generation failed: ${JSON.stringify(status)}`,
              );
            }

            console.log(
              `Status: ${audioStatus || JSON.stringify(status).slice(0, 100)}`,
            );
          } catch (err) {
            if (err.message.includes("Audio generation failed")) throw err;
            console.warn(`Status check failed: ${err.message}`);
          }

          if (attempt < maxAttempts) {
            await new Promise((r) => setTimeout(r, pollInterval));
          }
        }

        throw new Error("Audio generation timed out after 10 minutes");
      },
    },
    {
      name: "download-audio",
      type: "file",
      fn: async (ctx) => {
        const outputPath = `/tmp/podcast-${id}.m4a`;

        await nlm(
          [
            "download",
            "audio",
            ctx.notebookId,
            "-o",
            outputPath,
            "--no-progress",
          ],
          { timeout: 120000 },
        );

        ctx.audioBuffer = await readFile(outputPath);
        ctx.outputPath = outputPath;
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
        if (ctx.audioBuffer.length < 1000) {
          throw new Error(
            `Audio file suspiciously small: ${ctx.audioBuffer.length} bytes`,
          );
        }
      },
    },
    {
      name: "upload-to-supabase",
      type: "api",
      fn: async (ctx) => {
        const storagePath = `${id}.m4a`;
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
        console.log(`Uploaded to Supabase Storage: ${ctx.publicUrl}`);
      },
    },
    {
      name: "mark-ready",
      type: "api",
      fn: async (ctx) => {
        await updatePodcast(id, {
          audio_url: ctx.publicUrl,
          status: "ready",
        });
        console.log(`Podcast ${id} is ready: ${ctx.publicUrl}`);

        // Clean up temp file
        try {
          if (ctx.outputPath) await unlink(ctx.outputPath);
        } catch (_) {
          // ignore cleanup errors
        }
      },
    },
    {
      name: "cleanup-old",
      type: "api",
      continueOnFail: true,
      fn: async () => {
        await cleanupOldPodcasts();
      },
    },
  ];

  const result = await runPipeline(`news-podcast-${id}`, steps, {
    onStepFail: async (step, err) => {
      console.error(`Step "${step.name}" failed:`, err?.message);
      await updatePodcast(id, {
        status: "failed",
        error_message: `Step "${step.name}" failed: ${err?.message}`,
      });
    },
  });

  if (!result.success) {
    console.error(`Pipeline failed for podcast ${id}: ${result.error}`);
  } else {
    console.log(`Pipeline complete for podcast ${id}.`);
  }
}

async function main() {
  // Find podcasts waiting for generation
  const { data: pending, error } = await supabase
    .from("podcasts")
    .select("id, topics, custom_query, article_count")
    .eq("status", "generating");

  if (error) {
    console.error("Failed to query podcasts:", error);
    process.exit(1);
  }

  if (!pending || pending.length === 0) {
    console.log("No podcasts pending generation.");
    return;
  }

  console.log(`Found ${pending.length} podcast(s) to generate.`);

  for (const podcast of pending) {
    await processPodcast(podcast);
  }
}

main();
