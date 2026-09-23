const POTWS_SHEET_ID = '1GgBJOLEAeMQ9txZJXrDebAFC6TjXcqZPfJ1ylJ2cALA';
const POTWS_SHEET_NAME = 'Crew Roster';
const POTWS_GVIZ_URL = `https://docs.google.com/spreadsheets/d/${POTWS_SHEET_ID}/gviz/tq?tqx=out:json&sheet=${encodeURIComponent(POTWS_SHEET_NAME)}`;

const POTWS_PORTRAIT_B64 = {
  'captain-ransom': 'crew-portraits/captain-ransom-mini.b64',
  'maelstrom': 'crew-portraits/maelstrom-mayhem-mini.b64',
  'sir-battle-griffin': 'crew-portraits/sir-battle-griffin-mini.b64'
};

function potwsCell(row, index) {
  const cell = row.c && row.c[index];
  if (!cell) return '';
  return cell.v == null ? '' : String(cell.v);
}

function potwsPortraitUrl(value) {
  if (!value) return '';
  const match = value.match(/[?&]id=([^&]+)/) || value.match(/\/d\/([^/]+)/);
  if (match) return `https://drive.google.com/thumbnail?id=${encodeURIComponent(match[1])}&sz=w1200`;
  return value;
}

async function potwsLoadPortraitOverride(pirate) {
  const key = pirate.slug || '';
  const file = POTWS_PORTRAIT_B64[key];
  if (!file) return pirate;
  try {
    const response = await fetch(`${file}?v=20260923d`, { cache: 'no-store' });
    if (!response.ok) return pirate;
    const b64 = (await response.text()).trim();
    if (b64) pirate.portrait = `data:image/jpeg;base64,${b64}`;
  } catch (e) {
    console.warn('Portrait override failed for', pirate.name, e);
  }
  return pirate;
}

async function loadPotwsCrew() {
  const response = await fetch(POTWS_GVIZ_URL, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Roster request failed (${response.status})`);
  const text = await response.text();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('Roster data was not readable.');
  const data = JSON.parse(text.slice(start, end + 1));
  const rows = data.table && data.table.rows ? data.table.rows : [];
  const crew = rows.map(row => ({
    id: potwsCell(row, 0).trim(),
    name: potwsCell(row, 1).trim(),
    active: potwsCell(row, 2).trim().toUpperCase(),
    order: Number(potwsCell(row, 3)) || 9999,
    role: potwsCell(row, 4).trim(),
    portrait: potwsPortraitUrl(potwsCell(row, 5).trim()),
    fullBio: potwsCell(row, 6),
    shortBio: potwsCell(row, 7),
    slug: potwsCell(row, 8).trim(),
    notes: potwsCell(row, 9)
  })).filter(p => p.name && p.active === 'Y').sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));

  await Promise.all(crew.map(potwsLoadPortraitOverride));
  return crew;
}

function potwsProfileHref(pirate) {
  return `crew-profile.html?pirate=${encodeURIComponent(pirate.slug || pirate.id)}`;
}

function potwsPhotoMarkup(pirate, altText) {
  if (!pirate.portrait) return `<div class="photo-slot">${altText}<br>Portrait Coming Soon</div>`;
  return `<div class="photo-slot" style="padding:0"><img src="${pirate.portrait}" alt="${altText}" loading="lazy" referrerpolicy="no-referrer"></div>`;
}
