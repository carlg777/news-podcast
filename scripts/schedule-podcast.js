/**
 * Schedule Podcast: Inserts a "generating" row into Supabase.
 *
 * The poll-and-generate.js poller will pick it up within 60s.
 * Runs via launchd at 7am, 12pm, and 5pm daily.
 *
 * Includes a rate-limit check: skips if a podcast was created
 * in the last 30 minutes to prevent double-generation.
 */

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://yifhgbpzdaphdkxpnydy.supabase.co";
const SUPABASE_SERVICE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlpZmhnYnB6ZGFwaGRreHBueWR5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MjU3MDY1MSwiZXhwIjoyMDg4MTQ2NjUxfQ.9hcMgdfqQlK8SJ3j_qF2aoRT89s3r1ut8M33TR48RQ4";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function main() {
  // Rate limit: skip if a podcast was created in the last 30 minutes
  const thirtyMinAgo = new Date();
  thirtyMinAgo.setMinutes(thirtyMinAgo.getMinutes() - 30);

  const { data: recent, error: queryError } = await supabase
    .from("podcasts")
    .select("id, created_at")
    .gte("created_at", thirtyMinAgo.toISOString())
    .limit(1);

  if (queryError) {
    console.error("Failed to check recent podcasts:", queryError);
    process.exit(1);
  }

  if (recent && recent.length > 0) {
    console.log(
      `Skipping: podcast ${recent[0].id} was created at ${recent[0].created_at} (within last 30 min).`,
    );
    return;
  }

  // Insert a new podcast row for the poller to pick up
  const { data: podcast, error: insertError } = await supabase
    .from("podcasts")
    .insert({
      topics: ["ai"],
      article_count: 8,
      status: "generating",
    })
    .select("id")
    .single();

  if (insertError) {
    console.error("Failed to create podcast:", insertError);
    process.exit(1);
  }

  console.log(
    `Scheduled podcast ${podcast.id} with topics: ai, article_count: 8`,
  );
}

main();
