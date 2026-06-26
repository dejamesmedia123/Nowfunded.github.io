// marketplace.gs
// Handles all Marketplace requests for NowFunded.
// Actions: getMarketplace, validateCode, submitOrder
// All Sheet/Token access via Script Properties only — no hardcoded values.

// ─────────────────────────────────────────────────────────────────────────────
// ROUTER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Entry point for POST requests from marketplace.html.
 *
 * @param {GoogleAppsScript.Events.DoPost} e
 * @returns {GoogleAppsScript.Content.TextOutput}
 */
function doPost(e) {
  try {
    var body   = JSON.parse(e.postData.contents);
    var action = body.action;

    if (action === "getMarketplace") return handleGetMarketplace(body);
    if (action === "validateCode")   return handleValidateCode(body);
    if (action === "submitOrder")    return handleSubmitOrder(body);

    return jsonResponse({ success: false, error: "Unknown action: " + action });

  } catch (err) {
    Logger.log("doPost error: " + err.message);
    return jsonResponse({ success: false, error: "Server error: " + err.message });
  }
}


// ─────────────────────────────────────────────────────────────────────────────
// HANDLER — getMarketplace
// Returns all active plans + wallet address from Settings.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @param {Object} body
 * @returns {GoogleAppsScript.Content.TextOutput}
 */
function handleGetMarketplace(body) {
  var ss = getSpreadsheet();

  // ── Fetch active plans ──
  var plansSheet = ss.getSheetByName("Plans");
  if (!plansSheet) return jsonResponse({ success: false, error: "Plans sheet not found." });

  var lastRow = plansSheet.getLastRow();
  var plans   = [];

  if (lastRow >= 2) {
    // Columns: plan_id(1) name(2) account_size(3) price_usd(4)
    //          phase1_target(5) phase2_target(6) max_drawdown(7)
    //          payout_split_first(8) payout_split_second(9) is_active(10)
    var rows = plansSheet.getRange(2, 1, lastRow - 1, 10).getValues();

    rows.forEach(function(row) {
      var isActive = row[9];
      // Accept TRUE (boolean), "TRUE" (string), 1 (number)
      if (isActive === true || String(isActive).toUpperCase() === "TRUE" || isActive === 1) {
        plans.push({
          plan_id:             String(row[0]),
          name:                String(row[1]),
          account_size:        row[2],
          price_usd:           row[3],
          phase1_target:       row[4],
          phase2_target:       row[5],
          max_drawdown:        row[6],
          payout_split_first:  row[7],
          payout_split_second: row[8]
        });
      }
    });
  }

  // ── Fetch wallet address from Settings ──
  var wallet = getSettingValue(ss, "wallet_address");

  return jsonResponse({ success: true, plans: plans, wallet: wallet });
}


// ─────────────────────────────────────────────────────────────────────────────
// HANDLER — validateCode
// Checks a promo code against the DiscountCodes sheet.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @param {Object} body
 * @param {string} body.code
 * @returns {GoogleAppsScript.Content.TextOutput}
 */
function handleValidateCode(body) {
  var code = String(body.code || "").trim().toUpperCase();

  if (!code) {
    return jsonResponse({ valid: false, error: "No code provided." });
  }

  var ss    = getSpreadsheet();
  var sheet = ss.getSheetByName("DiscountCodes");
  if (!sheet) return jsonResponse({ valid: false, error: "DiscountCodes sheet not found." });

  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return jsonResponse({ valid: false, error: "Code not found." });

  // Columns: code(1) type(2) discount_percent(3) max_uses(4) uses_so_far(5) is_active(6) created_at(7)
  var rows = sheet.getRange(2, 1, lastRow - 1, 6).getValues();

  for (var i = 0; i < rows.length; i++) {
    var row      = rows[i];
    var rowCode  = String(row[0]).trim().toUpperCase();
    var type     = String(row[1]).trim().toLowerCase();
    var pct      = Number(row[2]);
    var maxUses  = Number(row[3]);
    var usesSoFar= Number(row[4]);
    var isActive = row[5];
    var active   = (isActive === true || String(isActive).toUpperCase() === "TRUE" || isActive === 1);

    if (rowCode !== code) continue;

    // Found the code
    if (!active) {
      return jsonResponse({ valid: false, error: "This code is no longer active." });
    }

    // Points shop codes cannot be used directly at checkout — they are issued codes
    if (type === "points_shop") {
      return jsonResponse({ valid: false, error: "This code cannot be applied here." });
    }

    if (maxUses > 0 && usesSoFar >= maxUses) {
      return jsonResponse({ valid: false, error: "This code has reached its usage limit." });
    }

    return jsonResponse({
      valid:            true,
      code:             rowCode,
      discount_percent: pct
    });
  }

  return jsonResponse({ valid: false, error: "Code not found." });
}


// ─────────────────────────────────────────────────────────────────────────────
// HANDLER — submitOrder
// Writes a new row to Orders, increments discount code usage, notifies admin.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @param {Object} body
 * @param {string} body.telegram_id
 * @param {string} body.plan_id
 * @param {number} body.price_paid
 * @param {string} body.discount_code
 * @param {number} body.discount_amount
 * @param {string} body.payment_reference
 * @returns {GoogleAppsScript.Content.TextOutput}
 */
function handleSubmitOrder(body) {
  var telegramId       = String(body.telegram_id       || "").trim();
  var planId           = String(body.plan_id           || "").trim();
  var pricePaid        = Number(body.price_paid)        || 0;
  var discountCode     = String(body.discount_code     || "").trim();
  var discountAmount   = Number(body.discount_amount)   || 0;
  var paymentReference = String(body.payment_reference || "").trim();

  // ── Validate required fields ──
  if (!telegramId)       return jsonResponse({ success: false, error: "telegram_id is required." });
  if (!planId)           return jsonResponse({ success: false, error: "plan_id is required." });
  if (!paymentReference) return jsonResponse({ success: false, error: "payment_reference is required." });

  var ss = getSpreadsheet();

  // ── Look up the plan to get its name and original price ──
  var plansSheet = ss.getSheetByName("Plans");
  if (!plansSheet) return jsonResponse({ success: false, error: "Plans sheet not found." });

  var planData  = getPlanById(plansSheet, planId);
  if (!planData) return jsonResponse({ success: false, error: "Plan not found: " + planId });

  // ── Look up trader username from Users ──
  var usersSheet = ss.getSheetByName("Users");
  var username   = "";
  if (usersSheet) {
    var userRow = findUserRowData(usersSheet, telegramId);
    if (userRow) username = userRow[1] || ""; // column 2 = username
  }

  // ── Write order to Orders sheet ──
  var ordersSheet = ss.getSheetByName("Orders");
  if (!ordersSheet) return jsonResponse({ success: false, error: "Orders sheet not found." });

  var orderId   = generateId("ORD");
  var now       = new Date().toISOString();

  // Columns: order_id(1) telegram_id(2) plan_id(3) price_paid(4)
  //          discount_code(5) discount_amount(6) payment_reference(7)
  //          payment_status(8) created_at(9) confirmed_at(10)
  ordersSheet.appendRow([
    orderId,
    telegramId,
    planId,
    pricePaid,
    discountCode,
    discountAmount,
    paymentReference,
    "pending",
    now,
    ""            // confirmed_at: blank until admin confirms
  ]);

  // ── Increment discount code uses_so_far if a code was used ──
  if (discountCode) {
    incrementCodeUsage(ss, discountCode);
  }

  // ── Notify admin ──
  try {
    notifyAdminNewOrder(orderId, username || telegramId, planData.name, pricePaid);
  } catch (notifyErr) {
    // Non-fatal — order already saved
    Logger.log("Admin notify failed: " + notifyErr.message);
  }

  Logger.log("Order submitted: " + orderId + " by " + telegramId);

  return jsonResponse({ success: true, order_id: orderId });
}


// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Opens the spreadsheet via SPREADSHEET_ID Script Property.
 * @returns {GoogleAppsScript.Spreadsheet.Spreadsheet}
 */
function getSpreadsheet() {
  var id = PropertiesService.getScriptProperties().getProperty("SPREADSHEET_ID");
  if (!id) throw new Error("SPREADSHEET_ID not set in Script Properties.");
  return SpreadsheetApp.openById(id);
}

/**
 * Reads a single value from the Settings sheet by key.
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss
 * @param {string} key
 * @returns {string}
 */
function getSettingValue(ss, key) {
  var sheet = ss.getSheetByName("Settings");
  if (!sheet) return "";
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return "";
  var rows = sheet.getRange(2, 1, lastRow - 1, 2).getValues();
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][0]).trim() === key) return String(rows[i][1]).trim();
  }
  return "";
}

/**
 * Finds a plan row by plan_id and returns a plain object or null.
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @param {string} planId
 * @returns {Object|null}
 */
function getPlanById(sheet, planId) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;
  var rows = sheet.getRange(2, 1, lastRow - 1, 10).getValues();
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][0]).trim() === planId) {
      return {
        plan_id:   String(rows[i][0]),
        name:      String(rows[i][1]),
        price_usd: rows[i][3]
      };
    }
  }
  return null;
}

/**
 * Returns the full data row array for a user, or null.
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @param {string} telegramId
 * @returns {Array|null}
 */
function findUserRowData(sheet, telegramId) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;
  var rows = sheet.getRange(2, 1, lastRow - 1, 8).getValues();
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][0]).trim() === telegramId) return rows[i];
  }
  return null;
}

/**
 * Increments uses_so_far (column 5) for the matching discount code row.
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss
 * @param {string} code
 */
function incrementCodeUsage(ss, code) {
  var sheet   = ss.getSheetByName("DiscountCodes");
  if (!sheet) return;
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return;
  var rows = sheet.getRange(2, 1, lastRow - 1, 5).getValues();
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][0]).trim().toUpperCase() === code.toUpperCase()) {
      var cell = sheet.getRange(i + 2, 5); // uses_so_far is column 5
      cell.setValue((Number(rows[i][4]) || 0) + 1);
      return;
    }
  }
}

/**
 * Generates a short unique ID with a prefix, e.g. "ORD-A3F9B2".
 * @param {string} prefix
 * @returns {string}
 */
function generateId(prefix) {
  var chars  = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  var result = "";
  for (var i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return prefix + "-" + result;
}

/**
 * Returns a JSON TextOutput.
 * @param {Object} obj
 * @returns {GoogleAppsScript.Content.TextOutput}
 */
function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
