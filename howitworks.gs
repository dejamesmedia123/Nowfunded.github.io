/**
 * howitworks.gs
 * ─────────────────────────────────────────────────────────────────────────
 * Backend endpoint for howitworks.html (static FAQ page).
 *
 * This page is almost entirely static content — the only dynamic data it
 * needs is a handful of values from the Settings sheet (payout splits and
 * the current crypto wallet address), so traders always see live numbers
 * without us having to hardcode or update the HTML.
 *
 * Actions handled (routed from doGet in the main Code.gs / router):
 *   - getHowItWorksSettings : read-only fetch of select Settings rows
 *
 * Sheets touched: Settings (read only — no writes from this file)
 * ─────────────────────────────────────────────────────────────────────────
 */

const HIW_SETTINGS_SHEET = 'Settings';

// Keys this screen cares about. Add more here if the FAQ copy expands.
const HIW_SETTINGS_KEYS = [
  'split_first',
  'split_second',
  'wallet_address',
];

/**
 * Router entry point — call this from your main doGet(e) switch
 * on e.g. `if (action === 'getHowItWorksSettings') return handleGetHowItWorksSettings();`
 *
 * Intentionally takes no payload / requires no telegram_id — this is public,
 * read-only reference content, same as the publicStats endpoint used on index.html.
 */
function handleGetHowItWorksSettings() {
  try {
    const settings = readSettingsByKeys_(HIW_SETTINGS_KEYS);
    return jsonSuccess_(settings);
  } catch (err) {
    console.error('getHowItWorksSettings failed: ' + err);
    // Fail soft — the FAQ page renders fine with static copy alone
    return jsonSuccess_({});
  }
}

// ─────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────

/** Reads the Settings sheet and returns only the requested keys as a flat object. */
function readSettingsByKeys_(keys) {
  const ss    = getSpreadsheet_();
  const sheet = ss.getSheetByName(HIW_SETTINGS_SHEET);
  const data  = sheet.getDataRange().getValues();
  const headers = data[0];

  const keyCol   = headers.indexOf('key');
  const valueCol = headers.indexOf('value');

  const wanted = new Set(keys);
  const result = {};

  for (let i = 1; i < data.length; i++) {
    const key = String(data[i][keyCol]);
    if (wanted.has(key)) {
      result[key] = data[i][valueCol];
    }
  }

  return result;
}

/** Opens the spreadsheet via the Script Property — never hardcode the ID. */
function getSpreadsheet_() {
  const id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  return SpreadsheetApp.openById(id);
}

function jsonSuccess_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function jsonError_(message) {
  return ContentService
    .createTextOutput(JSON.stringify({ success: false, error: message }))
    .setMimeType(ContentService.MimeType.JSON);
}
