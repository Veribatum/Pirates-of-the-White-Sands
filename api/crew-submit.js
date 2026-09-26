const REPO = 'Veribatum/Pirates-of-the-White-Sands';
const BRANCH = 'main';
const ROSTER_PATH = 'crew-submissions.json';
const ALLOWED_ORIGINS = new Set([
  'https://piratesofthewhitesands.com',
  'https://www.piratesofthewhitesands.com'
]);

function cors(req, res) {
  const origin = req.headers.origin || '';
  if (ALLOWED_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 70);
}

async function gh(path, options = {}) {
  const token = process.env.POTWS_GITHUB_TOKEN;
  if (!token) throw new Error('Server is missing POTWS_GITHUB_TOKEN');
  const response = await fetch(`https://api.github.com/repos/${REPO}/contents/${path}`, {
    ...options,
    headers: {
      'Accept': 'application/vnd.github+json',
      'Authorization': `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (_) {}
  if (!response.ok) {
    const message = data && data.message ? data.message : `GitHub request failed (${response.status})`;
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }
  return data;
}

async function getRoster() {
  const data = await gh(`${ROSTER_PATH}?ref=${encodeURIComponent(BRANCH)}`, { method: 'GET', headers: { 'Content-Type': undefined } });
  const json = Buffer.from(data.content.replace(/\n/g, ''), 'base64').toString('utf8');
  return { items: JSON.parse(json), sha: data.sha };
}

async function putFile(path, contentBase64, message, sha) {
  return gh(path, {
    method: 'PUT',
    body: JSON.stringify({
      message,
      content: contentBase64,
      branch: BRANCH,
      ...(sha ? { sha } : {})
    })
  });
}

module.exports = async function handler(req, res) {
  cors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  try {
    const body = req.body || {};
    const pirateName = String(body.pirateName || '').trim();
    const pirateBio = String(body.pirateBio || '').trim();
    const fileName = String(body.fileName || '').trim();
    const mimeType = String(body.mimeType || '').trim();
    const imageBase64 = String(body.imageBase64 || '').trim();
    const honeypot = String(body.website || '').trim();

    if (honeypot) return res.status(200).json({ ok: true });
    if (!pirateName || !pirateBio || !fileName || !imageBase64) {
      return res.status(400).json({ ok: false, error: 'Missing required fields' });
    }
    if (pirateName.length > 80 || pirateBio.length > 4000) {
      return res.status(400).json({ ok: false, error: 'Submission is too long' });
    }

    const allowed = {
      'image/jpeg': '.jpg',
      'image/png': '.png',
      'image/webp': '.webp'
    };
    if (!allowed[mimeType]) return res.status(400).json({ ok: false, error: 'Unsupported image type' });

    const approxBytes = Math.floor(imageBase64.length * 0.75);
    if (approxBytes > 10 * 1024 * 1024) return res.status(400).json({ ok: false, error: 'Image is too large' });

    let slug = slugify(pirateName);
    if (!slug) slug = `pirate-${Date.now()}`;
    const portraitPath = `crew-portraits/${slug}${allowed[mimeType]}`;

    let existingPhotoSha;
    try {
      const existing = await gh(`${portraitPath}?ref=${encodeURIComponent(BRANCH)}`, { method: 'GET', headers: { 'Content-Type': undefined } });
      existingPhotoSha = existing.sha;
    } catch (error) {
      if (error.status !== 404) throw error;
    }

    await putFile(
      portraitPath,
      imageBase64,
      `${existingPhotoSha ? 'Update' : 'Add'} portrait for ${pirateName}`,
      existingPhotoSha
    );

    for (let attempt = 0; attempt < 2; attempt++) {
      const { items, sha } = await getRoster();
      const now = new Date().toISOString();
      const entry = {
        id: slug,
        name: pirateName,
        active: 'Y',
        order: 9999,
        role: 'Crew',
        portrait: portraitPath,
        fullBio: pirateBio,
        shortBio: pirateBio,
        slug,
        notes: '',
        submittedAt: now
      };
      const index = items.findIndex(item => item.slug === slug || String(item.name || '').toLowerCase() === pirateName.toLowerCase());
      if (index >= 0) items[index] = { ...items[index], ...entry };
      else items.push(entry);

      try {
        await putFile(
          ROSTER_PATH,
          Buffer.from(JSON.stringify(items, null, 2) + '\n', 'utf8').toString('base64'),
          `${index >= 0 ? 'Update' : 'Add'} crew profile for ${pirateName}`,
          sha
        );
        return res.status(200).json({ ok: true, slug, portrait: portraitPath });
      } catch (error) {
        if (!(error.status === 409 || error.status === 422) || attempt === 1) throw error;
      }
    }
  } catch (error) {
    console.error(error);
    return res.status(500).json({ ok: false, error: 'Submission failed' });
  }
};
