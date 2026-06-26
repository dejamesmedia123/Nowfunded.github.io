// onboarding.gs
// Handles the onboarding completion write for NowFunded.
// Called via doPost from onboarding.html.
// Reads SPREADSHEET_ID from Script Properties only — no hardcoded IDs.

// ─────────────────────────────────────────────────────────────────────────────
// ROUTER — all requests from onboarding.html arrive here via doPost
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Entry point for POST requests from onboarding.html.
 * Expected body: { action: "completeOnboarding", telegram_id: "<id>" }
 *
 * @param {GoogleAppsScript.Events.DoPost} e
 * @returns {GoogleAppsScript.Content.TextOutput} JSON response
 */
function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    var action = body.action;

    if (action === "completeOnboarding") {
      return handleCompleteOnboarding(body);
    }

    return jsonResponse({ success: false, error: "Unknown action: " + action });

  } catch (err) {
    Logger.log("doPost error: " + err.message);
    return jsonResponse({ success: false, error: "Server error: " + err.message });
  }
}


// ─────────────────────────────────────────────────────────────────────────────
// HANDLER — completeOnboarding
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Marks onboarding_complete = true for the given telegram_id in the Users sheet.
 * If the user row does not exist, returns an error — user creation is handled by index.gs.
 *
 * @param {Object} body  Parsed request body
 * @param {string} body.telegram_id
 * @returns {GoogleAppsScript.Content.TextOutput}
 */
function handleCompleteOnboarding(body) {
  var telegramId = String(body.telegram_id || "").trim();

  if (!telegramId) {
    return jsonResponse({ success: false, error: "telegram_id is required." });
  }

  var ss    = getSpreadsheet();
  var sheet = ss.getSheetByName("Users");

  if (!sheet) {
    return jsonResponse({ success: false, error: "Users sheet not found." });
  }

  var rowIndex = findUserRow(sheet, telegramId);

  if (rowIndex === -1) {
    return jsonResponse({ success: false, error: "User not found: " + telegramId });
  }

  // onboarding_complete is column 8 (H) — 1-indexed
  // Columns: telegram_id(1) username(2) first_name(3) referral_code(4)
  //          referred_by(5) points_balance(6) join_date(7) onboarding_complete(8)
  var ONBOARDING_COL = 8;

  sheet.getRange(rowIndex, ONBOARDING_COL).setValue(true);

  Logger.log("Onboarding completed for telegram_id: " + telegramId);

  return jsonResponse({ success: true, telegram_id: telegramId });
}


// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Opens the spreadsheet using SPREADSHEET_ID from Script Properties.
 * Throws if the property is not set.
 *
 * @returns {GoogleAppsScript.Spreadsheet.Spreadsheet}
 */
function getSpreadsheet() {
  var id = PropertiesService.getScriptProperties().getProperty("SPREADSHEET_ID");
  if (!id) throw new Error("SPREADSHEET_ID not set in Script Properties.");
  return SpreadsheetApp.openById(id);
}

/**
 * Finds the 1-indexed row number of a user in the Users sheet by telegram_id.
 * telegram_id is always column 1 (A).
 * Returns -1 if not found.
 *
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @param {string} telegramId
 * @returns {number}
 */
function findUserRow(sheet, telegramId) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return -1; // only header row or empty

  // Read all telegram_ids in column A (skip header row 1)
  var ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();

  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]).trim() === telegramId) {
      return i + 2; // +2 because we started at row 2
    }
  }

  return -1;
}

/**
 * Returns a JSON TextOutput with CORS headers.
 *
 * @param {Object} obj  Plain object to serialise
 * @returns {GoogleAppsScript.Content.TextOutput}
 */
function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
