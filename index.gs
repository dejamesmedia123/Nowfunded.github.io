// index.gs
// NowFunded — Entry-point & public-data handler.
//
// Actions:
//   POST  { action: 'indexBoot', telegram_id, username, first_name }
//         → Check / create user, return routing decision.
//
//   GET   ?action=publicStats
//         → Return aggregate stats shown on the landing page.
//
// Rules (blueprint §10):
//   • SPREADSHEET_ID read from Script Properties — never hardcoded.
//   • telegram_id is the single source of truth for user identity.
//   • create.gs scaffolds the sheet once; this file never touches headers.
//   • notifications.gs is not called here (no trader action yet at index).

// ─────────────────────────────────────────────────────────────────────────────
// doGet — public landing-page stats
// ─────────────────────────────────────────────────────────────────────────────

function doGet(e) {
  var output = ContentService.createTextOutput();
  output.setMimeType(ContentService.MimeType.JSON);

  var action = e && e.parameter && e.parameter.action;

  if (action === 'publicStats') {
    output.setContent(JSON.stringify(getPublicStats()));
  } else {
    output.setContent(JSON.stringify({ success: false, error: 'Unknown GET action.' }));
  }

  return output;
}

// ─────────────────────────────────────────────────────────────────────────────
// doPost — boot / user registration
// ─────────────────────────────────────────────────────────────────────────────

function doPost(e) {
  var output = ContentService.createTextOutput();
  output.setMimeType(ContentService.MimeType.JSON);

  try {
    var body   = JSON.parse(e.postData.contents);
    var action = body.action;

    if (action === 'indexBoot') {
      output.setContent(JSON.stringify(handleIndexBoot(body)));
    } else {
      output.setContent(JSON.stringify({ success: false, error: 'Unknown action: ' + action }));
    }
  } catch (err) {
    output.setContent(JSON.stringify({ success: false, error: err.message }));
  }

  return output;
}

// ─────────────────────────────────────────────────────────────────────────────
// HANDLER — indexBoot
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Checks if the telegram_id exists in the Users sheet.
 * Creates a new user record (with unique referral code) if they are new.
 * Returns routing decision for the frontend.
 *
 * @param {Object} body
 * @param {string} body.telegram_id
 * @param {string} body.username
 * @param {string} body.first_name
 * @returns {{ success: boolean, route?: 'onboarding'|'dashboard', error?: string }}
 */
function handleIndexBoot(body) {
  var telegramId = String(body.telegram_id || '').trim();
  var username   = String(body.username    || '').trim();
  var firstName  = String(body.first_name  || '').trim();

  if (!telegramId) {
    return { success: false, error: 'Missing telegram_id.' };
  }

  var sheet = getSheet('Users');
  var data  = sheet.getDataRange().getValues(); // row 0 = headers

  // Columns: telegram_id(0), username(1), first_name(2), referral_code(3),
  //          referred_by(4), points_balance(5), join_date(6), onboarding_complete(7)

  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) === telegramId) {
      // ── Existing user ───────────────────────────────────────
      var complete = data[i][7];
      var route    = (complete === true || complete === 'TRUE' || complete === 1)
                       ? 'dashboard'
                       : 'onboarding';
      return { success: true, route: route };
    }
  }

  // ── New user ────────────────────────────────────────────────
  var referralCode = generateReferralCode(data);
  var now          = new Date().toISOString();

  sheet.appendRow([
    telegramId,    // telegram_id
    username,      // username
    firstName,     // first_name
    referralCode,  // referral_code
    '',            // referred_by  (set by onboarding if start= param present)
    0,             // points_balance
    now,           // join_date
    false          // onboarding_complete
  ]);

  return { success: true, route: 'onboarding' };
}

// ─────────────────────────────────────────────────────────────────────────────
// HANDLER — publicStats
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns aggregate numbers shown on the public landing page.
 * Counts rows in Accounts and sums approved PayoutRequests.
 * Also reads default payout splits from the first active plan in Plans.
 *
 * @returns {{ success: boolean, accounts_issued: string, payouts_paid: string,
 *             split_first: number, split_second: number }}
 */
function getPublicStats() {
  try {
    var ss = getSpreadsheet();

    // Total accounts issued (any status, any phase)
    var accountsSheet = ss.getSheetByName('Accounts');
    var accountsCount = Math.max(0, accountsSheet.getLastRow() - 1); // subtract header

    // Total approved payouts value
    var payoutsSheet = ss.getSheetByName('PayoutRequests');
    var payoutsData  = payoutsSheet.getDataRange().getValues();
    // Columns: payout_id(0), account_id(1), telegram_id(2), amount_requested(3),
    //          trader_wallet(4), status(5), payout_number(6), split_applied(7),
    //          created_at(8), resolved_at(9)
    var totalPaid = 0;
    for (var i = 1; i < payoutsData.length; i++) {
      if (String(payoutsData[i][5]).toLowerCase() === 'approved') {
        totalPaid += parseFloat(payoutsData[i][3]) || 0;
      }
    }

    // Payout splits from first active plan
    var plansSheet = ss.getSheetByName('Plans');
    var plansData  = plansSheet.getDataRange().getValues();
    // Columns: plan_id(0), name(1), account_size(2), price_usd(3),
    //          phase1_target(4), phase2_target(5), max_drawdown(6),
    //          payout_split_first(7), payout_split_second(8), is_active(9)
    var splitFirst  = 70; // sensible defaults
    var splitSecond = 80;
    for (var j = 1; j < plansData.length; j++) {
      var isActive = plansData[j][9];
      if (isActive === true || isActive === 'TRUE' || isActive === 1) {
        splitFirst  = parseFloat(plansData[j][7]) || splitFirst;
        splitSecond = parseFloat(plansData[j][8]) || splitSecond;
        break;
      }
    }

    // Format totals
    var paidLabel;
    if (totalPaid >= 1000000) {
      paidLabel = (totalPaid / 1000000).toFixed(1) + 'M';
    } else if (totalPaid >= 1000) {
      paidLabel = (totalPaid / 1000).toFixed(0) + 'k';
    } else {
      paidLabel = totalPaid.toFixed(0);
    }

    return {
      success:          true,
      accounts_issued:  accountsCount > 0 ? accountsCount + '+' : '—',
      payouts_paid:     totalPaid > 0 ? paidLabel : '—',
      split_first:      splitFirst,
      split_second:     splitSecond,
    };

  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Opens the spreadsheet using SPREADSHEET_ID from Script Properties.
 * @returns {GoogleAppsScript.Spreadsheet.Spreadsheet}
 */
function getSpreadsheet() {
  var id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (!id) throw new Error('SPREADSHEET_ID not set in Script Properties.');
  return SpreadsheetApp.openById(id);
}

/**
 * Returns a named sheet from the spreadsheet.
 * @param {string} name
 * @returns {GoogleAppsScript.Spreadsheet.Sheet}
 */
function getSheet(name) {
  var sheet = getSpreadsheet().getSheetByName(name);
  if (!sheet) throw new Error('Sheet not found: ' + name);
  return sheet;
}

/**
 * Generates a unique 8-character alphanumeric referral code (prefix "NF").
 * Checks all existing codes in the already-fetched Users data to guarantee uniqueness.
 *
 * @param {Array[]} usersData - Full sheet data including header row.
 * @returns {string} e.g. "NF4X9K2M"
 */
function generateReferralCode(usersData) {
  // Build set of existing codes (column 3 = referral_code)
  var existing = {};
  for (var i = 1; i < usersData.length; i++) {
    if (usersData[i][3]) existing[String(usersData[i][3])] = true;
  }

  // Unambiguous chars — no O/0 or I/1
  var chars    = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  var code;
  var attempts = 0;

  do {
    code = 'NF';
    for (var j = 0; j < 6; j++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    if (++attempts > 200) {
      throw new Error('Could not generate a unique referral code after 200 attempts.');
    }
  } while (existing[code]);

  return code;
}
