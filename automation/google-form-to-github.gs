/*
 * Pirates of the White Sands
 * Google Form -> Crew Roster -> GitHub portrait automation
 *
 * Bind this script to the POTWS Crew Roster spreadsheet.
 * Store a fine-grained GitHub token in Script Properties as GITHUB_TOKEN,
 * then install an On form submit trigger for onCrewFormSubmit.
 *
 * After that every form submission will:
 *   1) find/create the pirate's Crew Roster row
 *   2) force Active = Y
 *   3) ensure a stable POTWS-### ID exists
 *   4) upload the submitted portrait to GitHub under crew-portraits/
 *   5) replace the roster Drive portrait link with the GitHub Pages path
 *   6) permanently delete the original Drive upload after the roster is safely updated
 *
 * IMPORTANT: full and short bios are preserved exactly as submitted.
 */

const POTWS_CONFIG = {
  rosterSheet: 'Crew Roster',
  responseSheet: 'Form Responses 1',
  repoOwner: 'Veribatum',
  repoName: 'Pirates-of-the-White-Sands',
  branch: 'main',
  portraitFolder: 'crew-portraits',
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

/*
 * Run this ONCE manually after pasting/updating the script.
 * Its only purpose is to make Apps Script request the full Google Drive scope
 * required for permanent file deletion. setTrashed(false) is a harmless no-op
 * on the active spreadsheet file.
 */
function authorizeDriveCleanup() {
  const ss = SpreadsheetApp.getActive();
  DriveApp.getFileById(ss.getId()).setTrashed(false);
  SpreadsheetApp.getUi().alert('Drive cleanup permission authorized.');
}

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

  // Admin defaults. Do not touch Captain-assigned role/title.
  roster.getRange(rosterRow, 3).setValue('Y');

  // Preserve submitted text exactly as supplied by the form.
  roster.getRange(rosterRow, 7).setValue(fullBio);
  roster.getRange(rosterRow, 8).setValue(shortBio);

  // Ensure the profile slug exists, but do not overwrite an existing slug.
  if (!String(roster.getRange(rosterRow, 9).getValue() || '').trim()) {
    roster.getRange(rosterRow, 9).setValue(slugify_(pirateName));
  }

  let cleanupFileId = '';
  let adminNote = 'Auto-imported from Google Form. Active set to Y. Role remains Captain-assigned.';

  if (drivePortrait) {
    const uploaded = copyDrivePortraitToGithub_(drivePortrait, pirateId, pirateName);

    // Write the GitHub path FIRST so a cleanup problem can never leave the site
    // pointing at a Drive file that was already copied successfully.
    roster.getRange(rosterRow, 6).setValue(uploaded.githubPath);
    cleanupFileId = uploaded.driveFileId;
    SpreadsheetApp.flush();
  }

  // Drive cleanup is intentionally non-fatal. If Google refuses deletion, the
  // website still uses the successful GitHub copy and the roster records the issue.
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

  // Give sheet formulas a moment to react to the new form response.
  for (let attempt = 0; attempt < 5; attempt++) {
    const lastRow = Math.max(roster.getLastRow(), 2);
    const names = roster.getRange(2, 2, lastRow - 1, 1).getDisplayValues();
    for (let i = 0; i < names.length; i++) {
      if (String(names[i][0] || '').trim().toLowerCase() === normalized) return i + 2;
    }
    Utilities.sleep(500);
    SpreadsheetApp.flush();
  }

  const row = Math.max(roster.getLastRow() + 1, 2);
  roster.getRange(row, 2).setValue(pirateName);
  return row;
}

function ensurePirateId_(roster, row) {
  let id = String(roster.getRange(row, 1).getDisplayValue() || '').trim();
  if (/^POTWS-\d{3,}$/.test(id)) return id;

  // Stable code-only ID based on the roster row. Row 2 = POTWS-001.
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

  // Google Drive returns HTTP 204 when deletion succeeds.
  if (response.getResponseCode() !== 204) {
    throw new Error(`Drive cleanup failed (${response.getResponseCode()}): ${response.getContentText()}`);
  }
}

function uploadBlobToGithub_(path, blob, commitMessage) {
  const token = PropertiesService.getScriptProperties().getProperty(POTWS_CONFIG.tokenProperty);
  if (!token) throw new Error('GitHub token is missing. Add GITHUB_TOKEN under Project Settings -> Script Properties.');

  const apiUrl = `https://api.github.com/repos/${POTWS_CONFIG.repoOwner}/${POTWS_CONFIG.repoName}/contents/${encodePath_(path)}`;
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28'
  };

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
