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

  // Extract SNlM0e token
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
  // Use compact JSON (no spaces) to match Chrome's format
  const paramsJson = JSON.stringify(params).replace(/ /g, '');
  const fReq = JSON.stringify([[[rpcId, paramsJson, null, 'generic']]]).replace(/ /g, '');

  const urlParams = new URLSearchParams({
    'rpcids': rpcId,
    'source-path': sourcePath,
    'bl': BUILD_LABEL,
    'hl': 'en',
    'rt': 'c',
  });

  // Use encodeURIComponent (percent-encoding) instead of URLSearchParams
  // to match NotebookLM's expected format
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
    body: body,
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
 */
function parseRpcResponse(text, rpcId) {
  // Response format: )]}\n followed by length-prefixed JSON chunks
  const lines = text.split('\n');
  for (const line of lines) {
    if (line.startsWith('[')) {
      try {
        const outer = JSON.parse(line);
        // Find the response for our RPC ID
        for (const item of outer) {
          if (Array.isArray(item) && item[0] === 'wrb.fr' && item[1] === rpcId) {
            if (item[2]) {
              return JSON.parse(item[2]);
            }
            return null;
          }
        }
      } catch {
        // Not the line we want, continue
      }
    }
  }

  // Try parsing multi-chunk format
  const allText = text.replace(/^\)\]\}'\n/, '');
  const chunks = allText.split(/\n\d+\n/).filter(Boolean);
  for (const chunk of chunks) {
    try {
      const parsed = JSON.parse(chunk);
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (Array.isArray(item) && item[0] === 'wrb.fr' && item[1] === rpcId && item[2]) {
            return JSON.parse(item[2]);
          }
        }
      }
    } catch {
      // Continue
    }
  }

  return null;
}

/**
 * Create a new notebook. Returns the notebook ID.
 */
export async function createNotebook(title) {
  console.log(`Creating notebook: ${title}`);
  const result = await rpc('CCqFvf', [[title]]);

  // Response: [[[notebook_id], title, ...], ...]
  if (result && result[0] && result[0][0] && result[0][0][0]) {
    const notebookId = result[0][0][0];
    console.log(`Notebook created: ${notebookId}`);
    return notebookId;
  }
  throw new Error(`Failed to create notebook. Response: ${JSON.stringify(result).slice(0, 200)}`);
}

/**
 * Add a URL source to a notebook.
 */
export async function addSource(notebookId, url) {
  console.log(`Adding source: ${url}`);

  const isYouTube = url.includes('youtube.com') || url.includes('youtu.be');
  const sourceData = new Array(11).fill(null);
  sourceData[10] = 1; // source type flag

  if (isYouTube) {
    sourceData[7] = [url]; // YouTube goes in position 7
  } else {
    sourceData[2] = [url]; // Regular URL goes in position 2
  }

  const params = [
    [sourceData],
    notebookId,
    [2],
    [1, null, null, null, null, null, null, null, null, null, [1]],
  ];

  await rpc('izAoDd', params, `/notebook/${notebookId}`);
}

/**
 * Create an audio artifact and poll until complete.
 * Returns the audio URL.
 */
export async function generateAudio(notebookId) {
  console.log('Starting audio generation...');

  // First, get notebook sources to pass to studio
  const notebookData = await rpc('rLM1Ne', [[notebookId]], `/notebook/${notebookId}`);

  // Extract source IDs from notebook data
  let sourceIds = [];
  if (notebookData) {
    try {
      // Sources are typically in the notebook's source list
      const sources = notebookData[0]?.[12] || notebookData[0]?.[9] || [];
      for (const src of sources) {
        if (Array.isArray(src) && src[0]) {
          const srcId = Array.isArray(src[0]) ? src[0][0] : src[0];
          if (typeof srcId === 'string') {
            sourceIds.push(srcId);
          }
        }
      }
    } catch {
      // If we can't extract sources, try without them
    }
  }

  console.log(`Found ${sourceIds.length} sources in notebook`);

  // Create studio audio artifact
  const nestedSrcIds = sourceIds.map(id => [[id]]);
  const simpleSrcIds = sourceIds.map(id => [id]);

  const studioParams = [
    [2],
    notebookId,
    [
      null, null,
      1, // STUDIO_TYPE_AUDIO
      nestedSrcIds,
      null, null,
      [
        null,
        [
          null, // no focus prompt
          2,    // default length
          null,
          simpleSrcIds,
          'en',
          null,
          1, // deep_dive format
        ],
      ],
    ],
  ];

  const createResult = await rpc('R7cb6c', studioParams, `/notebook/${notebookId}`);

  // Extract artifact ID
  let artifactId = null;
  if (createResult) {
    // Try common positions for artifact ID
    artifactId = createResult[0]?.[0] || createResult[0] || null;
    if (Array.isArray(artifactId)) artifactId = artifactId[0];
  }
  console.log(`Audio generation started. Artifact ID: ${artifactId || 'unknown'}`);

  // Poll for completion
  let attempts = 0;
  const maxAttempts = 40; // 10 minutes at 15s intervals

  while (attempts < maxAttempts) {
    await new Promise(resolve => setTimeout(resolve, 15000));
    attempts++;

    const pollParams = [
      [2],
      notebookId,
      [
        artifactId ? [artifactId] : null,
        null,
        1, // audio type
      ],
    ];

    const status = await rpc('gArtLc', pollParams, `/notebook/${notebookId}`);
    console.log(`Audio poll (attempt ${attempts}): ${JSON.stringify(status).slice(0, 200)}`);

    if (status) {
      // Check for completed status and audio URL
      const statusStr = JSON.stringify(status);

      // Look for a URL in the response (storage.googleapis.com or other audio URL)
      const urlMatch = statusStr.match(/(https:\/\/[^"]+\.(?:mp3|mp4|m4a|wav|webm)[^"]*)/i) ||
                       statusStr.match(/(https:\/\/storage\.googleapis\.com\/[^"]+)/);
      if (urlMatch) {
        console.log('Audio generation complete!');
        return { artifactId, audioUrl: urlMatch[1] };
      }

      // Check for error indicators
      if (statusStr.includes('"failed"') || statusStr.includes('"error"')) {
        throw new Error(`Audio generation failed: ${statusStr.slice(0, 300)}`);
      }
    }
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
