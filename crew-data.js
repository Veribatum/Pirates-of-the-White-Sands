const POTWS_SHEET_ID = '1GgBJOLEAeMQ9txZJXrDebAFC6TjXcqZPfJ1ylJ2cALA';
const POTWS_SHEET_NAME = 'Crew Roster';
const POTWS_GVIZ_URL = `https://docs.google.com/spreadsheets/d/${POTWS_SHEET_ID}/gviz/tq?tqx=out:json&sheet=${encodeURIComponent(POTWS_SHEET_NAME)}`;
const POTWS_LOCAL_ROSTER_URL = 'crew-submissions.json';

const POTWS_PORTRAIT_DIRECT = {
  'captain-ransom': 'crew-portraits/captain-ransom-final.jpg',
  'ransom-mayhem': 'crew-portraits/captain-ransom-final.jpg',
  'maelstrom': 'crew-portraits/maelstrom-mayhem-final.jpeg',
  'maelstrom-mayhem': 'crew-portraits/maelstrom-mayhem-final.jpeg',
  'sir-battle-griffin': 'crew-portraits/sir-battle-griffin-final.jpeg',
  'northstar': 'crew-portraits/Northstar.jpg',
  'osprey': 'crew-portraits/Osprey.jpg',
  'killian': 'crew-portraits/potws-007-kilian.webp',
  'kilian-cipher': 'crew-portraits/potws-007-kilian.webp',
  'tal': 'crew-portraits/potws-008-tal.webp',
  'argussea': 'crew-portraits/potws-009-argussea.webp',
  'black-janiels': 'crew-portraits/Black J Gun.jpg'
};

function potwsCell(row, index) {
  const cell = row.c && row.c[index];
  if (!cell) return '';
  return cell.v == null ? '' : String(cell.v);
}

function potwsSlug(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function potwsValidSlug(value) {
  const slug = String(value || '').trim();
  return slug && !slug.includes('#REF!') ? slug : '';
}

function potwsDriveFileId(value) {
  if (!value) return '';
  const match = String(value).match(/[?&]id=([^&]+)/) || String(value).match(/\/d\/([^/]+)/);
  return match ? match[1] : '';
}

function potwsPortraitUrl(value) {
  const raw = String(value || '').trim();
  if (!raw || raw.includes('#REF!')) return '';
  const id = potwsDriveFileId(raw);
  if (id) return `https://drive.google.com/thumbnail?id=${encodeURIComponent(id)}&sz=w1200`;
  if (/^https?:\/\//i.test(raw)) return raw;
  return new URL(raw, window.location.href).href;
}

function potwsPortraitFallback(img) {
  const id = img && img.dataset ? img.dataset.driveId : '';
  if (!id) return;
  const attempt = Number(img.dataset.fallbackAttempt || '0');
  const fallbacks = [
    `https://lh3.googleusercontent.com/d/${encodeURIComponent(id)}=w1200`,
    `https://drive.usercontent.google.com/download?id=${encodeURIComponent(id)}&export=view&authuser=0`
  ];
  if (attempt >= fallbacks.length) {
    img.onerror = null;
    return;
  }
  img.dataset.fallbackAttempt = String(attempt + 1);
  img.src = fallbacks[attempt];
}

async function potwsLoadPortraitOverride(pirate) {
  const slugKey = potwsValidSlug(pirate.slug);
  const nameKey = potwsSlug(pirate.name);
  const key = POTWS_PORTRAIT_DIRECT[slugKey] ? slugKey : nameKey;
  if (POTWS_PORTRAIT_DIRECT[key]) {
    pirate.portrait = new URL(`${POTWS_PORTRAIT_DIRECT[key]}?v=20260926-crewfix`, window.location.href).href;
  }
  if (!slugKey) pirate.slug = nameKey || pirate.id;
  return pirate;
}

async function potwsLoadSheetCrew() {
  const response = await fetch(POTWS_GVIZ_URL, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Roster request failed (${response.status})`);
  const text = await response.text();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('Roster data was not readable.');
  const data = JSON.parse(text.slice(start, end + 1));
  const rows = data.table && data.table.rows ? data.table.rows : [];
  return rows.map(row => ({
    id: potwsCell(row, 0).trim(),
    name: potwsCell(row, 1).trim(),
    active: potwsCell(row, 2).trim().toUpperCase(),
    order: Number(potwsCell(row, 3)) || 9999,
    role: potwsCell(row, 4).trim(),
    portrait: potwsPortraitUrl(potwsCell(row, 5).trim()),
    fullBio: potwsCell(row, 6),
    shortBio: potwsCell(row, 7),
    slug: potwsValidSlug(potwsCell(row, 8)) || potwsSlug(potwsCell(row, 1)),
    notes: potwsCell(row, 9)
  })).filter(p => p.name && p.active === 'Y');
}

async function potwsLoadLocalCrew() {
  try {
    const response = await fetch(`${POTWS_LOCAL_ROSTER_URL}?v=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) return [];
    const crew = await response.json();
    if (!Array.isArray(crew)) return [];
    return crew.filter(p => p && p.name && String(p.active || 'Y').toUpperCase() === 'Y');
  } catch (_) {
    return [];
  }
}

async function loadPotwsCrew() {
  const [sheetCrew, localCrew] = await Promise.all([
    potwsLoadSheetCrew(),
    potwsLoadLocalCrew()
  ]);

  const merged = new Map();
  for (const pirate of sheetCrew) {
    const key = pirate.slug || pirate.id || potwsSlug(pirate.name);
    merged.set(key, pirate);
  }
  for (const pirate of localCrew) {
    const key = potwsValidSlug(pirate.slug) || pirate.id || potwsSlug(pirate.name);
    merged.set(key, { ...(merged.get(key) || {}), ...pirate });
  }

  const crew = Array.from(merged.values())
    .filter(p => p.name && String(p.active || 'Y').toUpperCase() === 'Y')
    .sort((a, b) => (Number(a.order) || 9999) - (Number(b.order) || 9999) || a.name.localeCompare(b.name));

  await Promise.all(crew.map(potwsLoadPortraitOverride));
  return crew;
}

function potwsProfileHref(pirate) {
  return `crew-profile.html?pirate=${encodeURIComponent(potwsValidSlug(pirate.slug) || potwsSlug(pirate.name) || pirate.id)}`;
}

function potwsPhotoMarkup(pirate, altText) {
  if (!pirate.portrait) return `<div class="photo-slot">${altText}<br>Portrait Coming Soon</div>`;
  const driveId = potwsDriveFileId(pirate.portrait);
  const fallbackAttrs = driveId
    ? ` data-drive-id="${driveId}" data-fallback-attempt="0" onerror="potwsPortraitFallback(this)"`
    : '';
  return `<div class="photo-slot" style="padding:0"><img src="${pirate.portrait}" alt="${altText}" loading="lazy" referrerpolicy="no-referrer"${fallbackAttrs}></div>`;
}
