/*
 * Pirates of the White Sands
 * Crew intake automation
 *
 * Supports BOTH:
 *   1) the existing Google Form -> Sheet workflow
 *   2) the hidden crew-enlist.html page -> Apps Script Web App -> GitHub workflow
 *
 * The website workflow bypasses Google Forms and Google Drive entirely.
 */

const POTWS_CONFIG = {
  spreadsheetId: '1GgBJOLEAeMQ9txZJXrDebAFC6TjXcqZPfJ1ylJ2cALA',
  rosterSheet: 'Crew Roster',
  responseSheet: 'Form Responses 1',
  repoOwner: 'Veribatum',
  repoName: 'Pirates-of-the-White-Sands',
  branch: 'main',
  portraitFolder: 'crew-portraits',
  localRosterFile: 'crew-submissions.json',
  deleteDriveAfterUpload: true,
  tokenProperty: 'GITHUB_TOKEN'
};

function configureGithubToken() {
  const ui = SpreadsheetApp.getUi();
  const result = ui.prompt(
    'GitHub token',
    'Paste a fine-grained GitHub token with Contents: Read and write access to Veribatum/Pirates-of-the-White-Sands. The token is stored in Script Properties, not in the sheet.',
    ui.ButtonSet.OK_CANCEL
  );
  if (result.getSelectedButton() !== ui.Button.OK) return;
  const token = result.getResponseText().trim();
  if (!token) throw new Error('No token entered.');
  PropertiesService.getScriptProperties().setProperty(POTWS_CONFIG.tokenProperty, token);
  ui.alert('GitHub token saved.');
}

function installFormSubmitTrigger() {
  const ss = SpreadsheetApp.getActive();
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'onCrewFormSubmit')
    .forEach(t => ScriptApp.deleteTrigger(t));

  ScriptApp.newTrigger('onCrewFormSubmit')
    .forSpreadsheet(ss)
    .onFormSubmit()
    .create();

  SpreadsheetApp.getUi().alert('POTWS form-submit automation installed.');
}

function authorizeDriveCleanup() {
  const ss = SpreadsheetApp.getActive();
  DriveApp.getFileById(ss.getId()).setTrashed(false);
  SpreadsheetApp.getUi().alert('Drive cleanup permission authorized.');
}

/* ============================================================
 * HIDDEN WEBSITE INTAKE
 * crew-enlist.html sends JSON with:
 * pirateName, pirateBio, fileName, mimeType, imageBase64, website
 * ============================================================ */

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return jsonResponse_({ ok: false, error: 'Empty request.' });
    }

    const data = JSON.parse(e.postData.contents);

    if (String(data.website || '').trim()) {
      return jsonResponse_({ ok: true });
    }

    const pirateName = String(data.pirateName || '').trim();
    const pirateBio = String(data.pirateBio || '').trim();
    const mimeType = String(data.mimeType || '').toLowerCase();
    const fileName = String(data.fileName || 'portrait.jpg');
    const imageBase64 = String(data.imageBase64 || '').replace(/^data:[^;]+;base64,/, '');

    if (!pirateName) throw new Error('Pirate name is required.');
    if (!pirateBio) throw new Error('Pirate bio is required.');
    if (!imageBase64) throw new Error('Portrait photo is required.');
    if (!['image/jpeg', 'image/jpg', 'image/png', 'image/webp'].includes(mimeType)) {
      throw new Error('Portrait must be JPG, PNG, or WebP.');
    }

    const imageBytes = Utilities.base64Decode(imageBase64);
    if (imageBytes.length > 10 * 1024 * 1024) {
      throw new Error('Portrait must be under 10 MB.');
    }

    const ss = SpreadsheetApp.openById(POTWS_CONFIG.spreadsheetId);
    const roster = ss.getSheetByName(POTWS_CONFIG.rosterSheet);
    if (!roster) throw new Error(`Missing sheet: ${POTWS_CONFIG.rosterSheet}`);

    const rosterRow = findOrCreateRosterRow_(roster, pirateName);
    const pirateId = ensurePirateId_(roster, rosterRow);
    const slug = slugify_(pirateName);
    const ext = extensionForMime_(mimeType, fileName);
    const portraitPath = `${POTWS_CONFIG.portraitFolder}/${pirateId.toLowerCase()}-${slug}.${ext}`;
    const blob = Utilities.newBlob(imageBytes, mimeType, fileName);

    uploadBlobToGithub_(portraitPath, blob, `Add crew portrait for ${pirateName}`);

    roster.getRange(rosterRow, 2).setValue(pirateName);
    roster.getRange(rosterRow, 3).setValue('Y');
    if (!roster.getRange(rosterRow, 4).getValue()) {
      roster.getRange(rosterRow, 4).setValue(nextDisplayOrder_(roster, rosterRow));
    }
    roster.getRange(rosterRow, 6).setValue(portraitPath);
    roster.getRange(rosterRow, 7).setValue(pirateBio);
    roster.getRange(rosterRow, 8).setValue(pirateBio);
    roster.getRange(rosterRow, 9).setValue(slug);
    roster.getRange(rosterRow, 10).setValue('Submitted through private crew enlistment page.');
    SpreadsheetApp.flush();

    return jsonResponse_({ ok: true, id: pirateId, slug, portrait: portraitPath });
  } catch (err) {
    console.error(err);
    return jsonResponse_({ ok: false, error: err.message || String(err) });
  }
}

function doGet() {
  return jsonResponse_({ ok: true, service: 'POTWS crew intake' });
}

function upsertLocalCrewSubmission_(pirate) {
  const current = readGithubJsonFile_(POTWS_CONFIG.localRosterFile, []);
  const list = Array.isArray(current.data) ? current.data : [];
  const key = pirate.slug;
  const index = list.findIndex(item => item && (item.slug || item.id) === key);

  if (index >= 0) {
    list[index] = { ...list[index], ...pirate };
  } else {
    list.push(pirate);
  }

  writeGithubTextFile_(
    POTWS_CONFIG.localRosterFile,
    JSON.stringify(list, null, 2) + '\n',
    `Update crew roster for ${pirate.name}`,
    current.sha
  );
}

function readGithubJsonFile_(path, fallback) {
  const token = getGithubToken_();
  const apiUrl = githubContentsUrl_(path);
  const response = UrlFetchApp.fetch(`${apiUrl}?ref=${encodeURIComponent(POTWS_CONFIG.branch)}`, {
    method: 'get',
    headers: githubHeaders_(token),
    muteHttpExceptions: true
  });

  if (response.getResponseCode() === 404) {
    return { data: fallback, sha: '' };
  }
  if (response.getResponseCode() !== 200) {
    throw new Error(`GitHub read failed (${response.getResponseCode()}): ${response.getContentText()}`);
  }

  const payload = JSON.parse(response.getContentText());
  const decoded = Utilities.newBlob(Utilities.base64Decode(String(payload.content || '').replace(/\s/g, ''))).getDataAsString('UTF-8');
  return {
    data: decoded.trim() ? JSON.parse(decoded) : fallback,
    sha: payload.sha || ''
  };
}

function writeGithubTextFile_(path, text, commitMessage, sha) {
  const token = getGithubToken_();
  const payload = {
    message: commitMessage,
    content: Utilities.base64Encode(text, Utilities.Charset.UTF_8),
    branch: POTWS_CONFIG.branch
  };
  if (sha) payload.sha = sha;

  const response = UrlFetchApp.fetch(githubContentsUrl_(path), {
    method: 'put',
    headers: githubHeaders_(token),
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  const code = response.getResponseCode();
  if (code !== 200 && code !== 201) {
    throw new Error(`GitHub write failed (${code}): ${response.getContentText()}`);
  }
}

function jsonResponse_(value) {
  return ContentService
    .createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ============================================================
 * EXISTING GOOGLE FORM WORKFLOW
 * ============================================================ */

function onCrewFormSubmit(e) {
  if (!e || !e.range) throw new Error('This function must run from the spreadsheet form-submit trigger.');
  const responseSheet = e.range.getSheet();
  if (responseSheet.getName() !== POTWS_CONFIG.responseSheet) return;

  const row = e.range.getRow();
  const pirateName = String(responseSheet.getRange(row, 2).getDisplayValue() || '').trim();
  const fullBio = String(responseSheet.getRange(row, 3).getValue() || '');
  const shortBio = String(responseSheet.getRange(row, 4).getValue() || '');
  const drivePortrait = String(responseSheet.getRange(row, 5).getDisplayValue() || '').trim();

  if (!pirateName) throw new Error('Pirate Name is blank.');

  const ss = e.source || SpreadsheetApp.getActive();
  const roster = ss.getSheetByName(POTWS_CONFIG.rosterSheet);
  if (!roster) throw new Error(`Missing sheet: ${POTWS_CONFIG.rosterSheet}`);

  SpreadsheetApp.flush();
  const rosterRow = findOrCreateRosterRow_(roster, pirateName);
  const pirateId = ensurePirateId_(roster, rosterRow);

  roster.getRange(rosterRow, 3).setValue('Y');
  if (!roster.getRange(rosterRow, 4).getValue()) {
    roster.getRange(rosterRow, 4).setValue(nextDisplayOrder_(roster, rosterRow));
  }
  roster.getRange(rosterRow, 7).setValue(fullBio);
  roster.getRange(rosterRow, 8).setValue(shortBio);

  if (!String(roster.getRange(rosterRow, 9).getValue() || '').trim()) {
    roster.getRange(rosterRow, 9).setValue(slugify_(pirateName));
  }

  let cleanupFileId = '';
  let adminNote = 'Auto-imported from Google Form. Active set to Y. Role remains Captain-assigned.';

  if (drivePortrait) {
    const uploaded = copyDrivePortraitToGithub_(drivePortrait, pirateId, pirateName);
    roster.getRange(rosterRow, 6).setValue(uploaded.githubPath);
    cleanupFileId = uploaded.driveFileId;
    SpreadsheetApp.flush();
  }

  if (cleanupFileId && POTWS_CONFIG.deleteDriveAfterUpload) {
    try {
      permanentlyDeleteDriveFile_(cleanupFileId);
    } catch (err) {
      adminNote += ` Portrait uploaded to GitHub, but Drive cleanup failed: ${err.message}`;
      console.error(err);
    }
  }

  roster.getRange(rosterRow, 10).setValue(adminNote);
  SpreadsheetApp.flush();
}

function findOrCreateRosterRow_(roster, pirateName) {
  const normalized = pirateName.trim().toLowerCase();
  const maxRows = roster.getMaxRows();
  const names = roster.getRange(2, 2, maxRows - 1, 1).getDisplayValues();

  for (let i = 0; i < names.length; i++) {
    if (String(names[i][0] || '').trim().toLowerCase() === normalized) {
      return i + 2;
    }
  }

  for (let i = 0; i < names.length; i++) {
    if (!String(names[i][0] || '').trim()) {
      const row = i + 2;
      roster.getRange(row, 2).setValue(pirateName);
      return row;
    }
  }

  roster.insertRowAfter(maxRows);
  const row = maxRows + 1;
  roster.getRange(row, 2).setValue(pirateName);
  return row;
}

function nextDisplayOrder_(roster, excludeRow) {
  const maxRows = roster.getMaxRows();
  const values = roster.getRange(2, 3, maxRows - 1, 2).getDisplayValues();
  let maxOrder = 0;

  for (let i = 0; i < values.length; i++) {
    const row = i + 2;
    if (row === excludeRow) continue;
    const active = String(values[i][0] || '').trim().toUpperCase();
    const order = Number(values[i][1]);
    if (active === 'Y' && Number.isFinite(order) && order > maxOrder && order < 9999) {
      maxOrder = order;
    }
  }

  return maxOrder + 1;
}

function ensurePirateId_(roster, row) {
  let id = String(roster.getRange(row, 1).getDisplayValue() || '').trim();
  if (/^POTWS-\d{3,}$/.test(id)) return id;

  id = `POTWS-${String(row - 1).padStart(3, '0')}`;
  roster.getRange(row, 1).setValue(id);
  return id;
}

function copyDrivePortraitToGithub_(driveUrl, pirateId, pirateName) {
  const fileId = extractDriveFileId_(driveUrl);
  if (!fileId) throw new Error(`Could not read Drive portrait ID from: ${driveUrl}`);

  const file = DriveApp.getFileById(fileId);
  const blob = file.getBlob();
  const mime = String(blob.getContentType() || '').toLowerCase();
  const ext = extensionForMime_(mime, file.getName());
  const slug = slugify_(pirateName);
  const path = `${POTWS_CONFIG.portraitFolder}/${pirateId.toLowerCase()}-${slug}.${ext}`;

  uploadBlobToGithub_(path, blob, `Add portrait for ${pirateName}`);

  return {
    githubPath: path,
    driveFileId: fileId
  };
}

function permanentlyDeleteDriveFile_(fileId) {
  const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`;
  const response = UrlFetchApp.fetch(url, {
    method: 'delete',
    headers: {
      Authorization: `Bearer ${ScriptApp.getOAuthToken()}`
    },
    muteHttpExceptions: true
  });

  if (response.getResponseCode() !== 204) {
    throw new Error(`Drive cleanup failed (${response.getResponseCode()}): ${response.getContentText()}`);
  }
}

/* ============================================================
 * GITHUB HELPERS
 * ============================================================ */

function getGithubToken_() {
  const token = PropertiesService.getScriptProperties().getProperty(POTWS_CONFIG.tokenProperty);
  if (!token) throw new Error('GitHub token is missing. Add GITHUB_TOKEN under Project Settings -> Script Properties.');
  return token;
}

function githubHeaders_(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28'
  };
}

function githubContentsUrl_(path) {
  return `https://api.github.com/repos/${POTWS_CONFIG.repoOwner}/${POTWS_CONFIG.repoName}/contents/${encodePath_(path)}`;
}

function uploadBlobToGithub_(path, blob, commitMessage) {
  const token = getGithubToken_();
  const apiUrl = githubContentsUrl_(path);
  const headers = githubHeaders_(token);

  let existingSha = '';
  const getResponse = UrlFetchApp.fetch(`${apiUrl}?ref=${encodeURIComponent(POTWS_CONFIG.branch)}`, {
    method: 'get',
    headers,
    muteHttpExceptions: true
  });

  if (getResponse.getResponseCode() === 200) {
    const existing = JSON.parse(getResponse.getContentText());
    existingSha = existing.sha || '';
  } else if (getResponse.getResponseCode() !== 404) {
    throw new Error(`GitHub lookup failed (${getResponse.getResponseCode()}): ${getResponse.getContentText()}`);
  }

  const payload = {
    message: commitMessage,
    content: Utilities.base64Encode(blob.getBytes()),
    branch: POTWS_CONFIG.branch
  };
  if (existingSha) payload.sha = existingSha;

  const putResponse = UrlFetchApp.fetch(apiUrl, {
    method: 'put',
    headers,
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  const code = putResponse.getResponseCode();
  if (code !== 200 && code !== 201) {
    throw new Error(`GitHub upload failed (${code}): ${putResponse.getContentText()}`);
  }
}

function extractDriveFileId_(url) {
  const text = String(url || '');
  let match = text.match(/[?&]id=([^&]+)/);
  if (match) return match[1];
  match = text.match(/\/d\/([^/]+)/);
  return match ? match[1] : '';
}

function extensionForMime_(mime, fileName) {
  const map = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'image/heic': 'heic'
  };
  if (map[mime]) return map[mime];
  const match = String(fileName || '').match(/\.([A-Za-z0-9]+)$/);
  return match ? match[1].toLowerCase() : 'jpg';
}

function slugify_(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'pirate';
}

function encodePath_(path) {
  return String(path).split('/').map(encodeURIComponent).join('/');
}