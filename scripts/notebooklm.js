import { writeFile } from 'node:fs/promises';
import path from 'node:path';

const BASE_URL = 'https://notebooklm.google.com';
const BATCH_URL = `${BASE_URL}/_/LabsTailwindUi/data/batchexecute`;
const BUILD_LABEL = 'boq_labs-tailwind-frontend_20260108.06_p0';

let cookies = '';
let csrfToken = '';

/**
 * Initialize auth from NLM_COOKIES env var (JSON string from auth.json).
 */
export async function refreshAuth() {
  const nlmCookiesJson = process.env.NLM_COOKIES;
  if (!nlmCookiesJson) {
    throw new Error('NLM_COOKIES environment variable not set');
  }

  const parsed = JSON.parse(nlmCookiesJson);
  cookies = parsed.cookies;

  // Fetch CSRF token from NotebookLM homepage
  console.log('Fetching CSRF token...');
  const res = await fetch(BASE_URL, {
    headers: {
      Cookie: cookies,
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
    },
  });

  const html = await res.text();

  const tokenMatch = html.match(/"SNlM0e":"([^"]+)"/);
  if (!tokenMatch) {
    throw new Error('Failed to extract CSRF token — cookies may have expired. Run `nlm login` locally to refresh.');
  }
  csrfToken = tokenMatch[1];
  console.log('CSRF token obtained successfully.');
}

/**
 * Make a batchexecute RPC call to NotebookLM.
 */
async function rpc(rpcId, params, sourcePath = '/') {
  const paramsJson = JSON.stringify(params);
  const fReq = JSON.stringify([[[rpcId, paramsJson, null, 'generic']]]);

  const urlParams = new URLSearchParams({
    'rpcids': rpcId,
    'source-path': sourcePath,
    'bl': BUILD_LABEL,
    'hl': 'en',
    'rt': 'c',
  });

  const body = `f.req=${encodeURIComponent(fReq)}&at=${encodeURIComponent(csrfToken)}&`;

  const res = await fetch(`${BATCH_URL}?${urlParams}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
      'Origin': BASE_URL,
      'Referer': `${BASE_URL}/`,
      'Cookie': cookies,
      'X-Same-Domain': '1',
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
    },
    body,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`RPC ${rpcId} failed (${res.status}): ${text.slice(0, 200)}`);
  }

  const text = await res.text();
  const result = parseRpcResponse(text, rpcId);
  if (result === null) {
    console.warn(`RPC ${rpcId} returned null. Raw response (first 500 chars):`);
    console.warn(text.slice(0, 500));
  }
  return result;
}

/**
 * Parse the batchexecute response format.
 * Format: )]}\n then length-prefixed JSON chunks.
 */
function parseRpcResponse(text, rpcId) {
  // Remove anti-XSSI prefix
  if (text.startsWith(")]}'")) {
    text = text.slice(4);
  }

  const lines = text.trim().split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i].trim();
    if (!line) { i++; continue; }

    // Try as byte count followed by JSON
    const byteCount = parseInt(line, 10);
    if (!isNaN(byteCount) && i + 1 < lines.length) {
      i++;
      try {
        const data = JSON.parse(lines[i]);
        if (Array.isArray(data)) {
          for (const item of data) {
            if (Array.isArray(item) && item[0] === 'wrb.fr' && item[1] === rpcId) {
              if (typeof item[2] === 'string') return JSON.parse(item[2]);
              return item[2];
            }
          }
        }
      } catch { /* continue */ }
      i++;
    } else {
      // Try as direct JSON
      try {
        const data = JSON.parse(line);
        if (Array.isArray(data)) {
          for (const item of data) {
            if (Array.isArray(item) && item[0] === 'wrb.fr' && item[1] === rpcId) {
              if (typeof item[2] === 'string') return JSON.parse(item[2]);
              return item[2];
            }
          }
        }
      } catch { /* continue */ }
      i++;
    }
  }

  return null;
}

/**
 * Create a new notebook. Returns the notebook ID.
 */
export async function createNotebook(title) {
  console.log(`Creating notebook: ${title}`);
  // Params match MCP: [title, null, null, [2], [1, null, null, null, null, null, null, null, null, null, [1]]]
  const params = [title, null, null, [2], [1, null, null, null, null, null, null, null, null, null, [1]]];
  const result = await rpc('CCqFvf', params);

  if (result && result[2]) {
    const notebookId = result[2];
    console.log(`Notebook created: ${notebookId}`);
    return notebookId;
  }
  throw new Error(`Failed to create notebook. Response: ${JSON.stringify(result).slice(0, 300)}`);
}

/**
 * Add a URL source to a notebook.
 */
export async function addSource(notebookId, url) {
  console.log(`Adding source: ${url}`);

  const isYouTube = url.includes('youtube.com') || url.includes('youtu.be');
  const sourceData = [null, null, null, null, null, null, null, null, null, null, 1];

  if (isYouTube) {
    sourceData[7] = [url];
  } else {
    sourceData[2] = [url];
  }

  const params = [
    [sourceData],
    notebookId,
    [2],
    [1, null, null, null, null, null, null, null, null, null, [1]],
  ];

  const result = await rpc('izAoDd', params, `/notebook/${notebookId}`);

  // Extract source ID from response
  if (result && Array.isArray(result) && result[0]) {
    const sourceList = result[0];
    if (Array.isArray(sourceList) && sourceList[0]) {
      const srcData = sourceList[0];
      const sourceId = Array.isArray(srcData[0]) ? srcData[0][0] : srcData[0];
      if (sourceId) {
        console.log(`Source added: ${sourceId}`);
        return sourceId;
      }
    }
  }
  console.warn(`Source added but couldn't extract ID for ${url}`);
  return null;
}

/**
 * Create an audio artifact and poll until complete.
 * @param {string} notebookId
 * @param {string[]} sourceIds - IDs returned from addSource calls
 * Returns { artifactId, audioUrl }.
 */
export async function generateAudio(notebookId, sourceIds = []) {
  console.log(`Starting audio generation with ${sourceIds.length} sources...`);

  // Build source arrays in both formats
  const sourcesNested = sourceIds.map(id => [[id]]);
  const sourcesSimple = sourceIds.map(id => [id]);

  const params = [
    [2],
    notebookId,
    [
      null, null,
      1, // STUDIO_TYPE_AUDIO
      sourcesNested,
      null, null,
      [
        null,
        [
          '', // no focus prompt
          2,  // default length
          null,
          sourcesSimple,
          'en',
          null,
          1, // deep_dive format
        ],
      ],
    ],
  ];

  const createResult = await rpc('R7cb6c', params, `/notebook/${notebookId}`);

  let artifactId = null;
  if (createResult && Array.isArray(createResult) && createResult[0]) {
    const artData = createResult[0];
    artifactId = Array.isArray(artData) ? artData[0] : artData;
  }
  console.log(`Audio generation started. Artifact ID: ${artifactId || 'unknown'}`);

  // Poll for completion
  let attempts = 0;
  const maxAttempts = 40; // 10 minutes at 15s intervals

  while (attempts < maxAttempts) {
    await new Promise(resolve => setTimeout(resolve, 15000));
    attempts++;

    // Poll params match MCP: [[2], notebook_id, 'NOT artifact.status = "ARTIFACT_STATUS_SUGGESTED"']
    const pollParams = [[2], notebookId, 'NOT artifact.status = "ARTIFACT_STATUS_SUGGESTED"'];
    const status = await rpc('gArtLc', pollParams, `/notebook/${notebookId}`);

    if (status && Array.isArray(status)) {
      const artifactList = Array.isArray(status[0]) ? status[0] : status;

      for (const art of artifactList) {
        if (!Array.isArray(art) || art.length < 5) continue;

        const artId = art[0];
        const typeCode = art[2];
        const statusCode = art[4];

        // Only care about audio (type 1)
        if (typeCode !== 1) continue;

        console.log(`Audio poll (attempt ${attempts}): artifact=${artId}, status=${statusCode}`);

        // Status 3 = completed, 1 = in_progress
        if (statusCode === 3) {
          // Audio URL is at art[6][5][n][0] where item[2] == "audio/mp4"
          let audioUrl = null;
          const metadata = art[6];
          if (Array.isArray(metadata) && metadata.length > 5 && Array.isArray(metadata[5])) {
            for (const item of metadata[5]) {
              if (Array.isArray(item) && item.length > 2 && item[2] === 'audio/mp4') {
                audioUrl = item[0];
                break;
              }
            }
            // Fallback: first URL in media list
            if (!audioUrl && metadata[5].length > 0 && Array.isArray(metadata[5][0])) {
              audioUrl = metadata[5][0][0];
            }
          }

          if (audioUrl) {
            console.log('Audio generation complete!');
            return { artifactId: artId, audioUrl };
          }
        }

        if (statusCode === 4) {
          throw new Error('Audio generation failed');
        }
      }
    }

    console.log(`Audio poll (attempt ${attempts}): still in progress...`);
  }

  throw new Error('Audio generation timed out after 10 minutes');
}

/**
 * Download audio from URL to a local file.
 * Returns the local file path.
 */
export async function downloadAudio(audioUrl) {
  const outputPath = path.join('/tmp', `podcast-${Date.now()}.mp3`);
  console.log(`Downloading audio to ${outputPath}...`);

  const res = await fetch(audioUrl, {
    headers: {
      Cookie: cookies,
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
    },
  });

  if (!res.ok) {
    throw new Error(`Audio download failed (${res.status})`);
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  await writeFile(outputPath, buffer);
  console.log(`Audio downloaded: ${buffer.length} bytes`);
  return outputPath;
}

/**
 * Delete a notebook.
 */
export async function deleteNotebook(notebookId) {
  console.log(`Deleting notebook: ${notebookId}`);
  try {
    await rpc('WWINqb', [[notebookId]], `/notebook/${notebookId}`);
  } catch (err) {
    console.warn(`Failed to delete notebook ${notebookId}:`, err.message);
  }
}
