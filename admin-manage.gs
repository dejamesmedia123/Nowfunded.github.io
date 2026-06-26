/**
 * admin-manage.gs
 * ─────────────────────────────────────────────────────────────────────────
 * Backend handlers for admin-manage.html (SPA B — Setup & Management).
 *
 * Scope: Plans, Discount Codes, Users (lookup), Settings.
 * This file knows nothing about Orders/Accounts/Payouts/Support — those
 * live in admin-ops.gs. Both files are registered with the SAME shared
 * doGet/doPost router in Code.gs; there is only one GAS deployment / URL.
 *
 * Every handler in this file calls requireAdminSession_() first — admin
 * password/session is re-validated on every request, not just at login.
 *
 * Sheets touched: Plans, DiscountCodes, Users, Orders, Accounts,
 *                  PointsLedger, Referrals, Settings
 * ─────────────────────────────────────────────────────────────────────────
 */

const PLANS_SHEET          = 'Plans';
const DISCOUNT_CODES_SHEET = 'DiscountCodes';
const USERS_SHEET_MGMT     = 'Users';
const ORDERS_SHEET_MGMT    = 'Orders';
const ACCOUNTS_SHEET_MGMT  = 'Accounts';
const POINTS_LEDGER_SHEET  = 'PointsLedger';
const REFERRALS_SHEET_MGMT = 'Referrals';
const SETTINGS_SHEET_MGMT  = 'Settings';

/**
 * Router entries — add these to the shared doPost(e) switch in Code.gs:
 *
 *   if (action === 'getPlans')            return handleGetPlans(payload);
 *   if (action === 'createPlan')          return handleCreatePlan(payload);
 *   if (action === 'updatePlan')          return handleUpdatePlan(payload);
 *   if (action === 'togglePlanActive')    return handleTogglePlanActive(payload);
 *   if (action === 'getDiscountCodes')    return handleGetDiscountCodes(payload);
 *   if (action === 'createPromoCode')     return handleCreatePromoCode(payload);
 *   if (action === 'toggleCodeActive')    return handleToggleCodeActive(payload);
 *   if (action === 'searchUsers')         return handleSearchUsers(payload);
 *   if (action === 'getUserDetail')       return handleGetUserDetail(payload);
 *   if (action === 'getSettings')         return handleGetSettings(payload);
 *   if (action === 'updateSettings')      return handleUpdateSettings(payload);
 */

// ─────────────────────────────────────────────────────────────────────────
// PLANS
// ─────────────────────────────────────────────────────────────────────────

function handleGetPlans(payload) {
  const authErr = requireAdminSession_(payload);
  if (authErr) return authErr;

  const ss = getSpreadsheet_();
  const plans = readAllRows_(ss, PLANS_SHEET).map(normalizePlan_);

  return jsonSuccess_({ success: true, plans: plans });
}

function handleCreatePlan(payload) {
  const authErr = requireAdminSession_(payload);
  if (authErr) return authErr;

  const required = ['name', 'account_size', 'price_usd', 'phase1_target', 'phase2_target',
    'max_drawdown', 'payout_split_first', 'payout_split_second'];
  for (const field of required) {
    if (payload[field] === undefined || payload[field] === null || payload[field] === '') {
      return jsonError_('Missing field: ' + field);
    }
  }

  const ss    = getSpreadsheet_();
  const sheet = ss.getSheetByName(PLANS_SHEET);

  const planId = 'PLAN-' + Utilities.getUuid().slice(0, 8).toUpperCase();
  const isActive = payload.is_active !== false; // default true

  // Columns: plan_id, name, account_size, price_usd, phase1_target, phase2_target,
  //          max_drawdown, payout_split_first, payout_split_second, is_active
  sheet.appendRow([
    planId,
    String(payload.name).trim(),
    Number(payload.account_size),
    Number(payload.price_usd),
    Number(payload.phase1_target),
    Number(payload.phase2_target),
    Number(payload.max_drawdown),
    Number(payload.payout_split_first),
    Number(payload.payout_split_second),
    isActive,
  ]);

  return jsonSuccess_({ success: true, plan_id: planId });
}

function handleUpdatePlan(payload) {
  const authErr = requireAdminSession_(payload);
  if (authErr) return authErr;

  const planId = String(payload.plan_id || '');
  if (!planId) return jsonError_('Missing plan_id.');

  const ss    = getSpreadsheet_();
  const sheet = ss.getSheetByName(PLANS_SHEET);
  const row   = findRowByValue_(sheet, 'plan_id', planId);
  if (!row) return jsonError_('Plan not found.');

  const fieldMap = {
    name: payload.name !== undefined ? String(payload.name).trim() : undefined,
    account_size: payload.account_size !== undefined ? Number(payload.account_size) : undefined,
    price_usd: payload.price_usd !== undefined ? Number(payload.price_usd) : undefined,
    phase1_target: payload.phase1_target !== undefined ? Number(payload.phase1_target) : undefined,
    phase2_target: payload.phase2_target !== undefined ? Number(payload.phase2_target) : undefined,
    max_drawdown: payload.max_drawdown !== undefined ? Number(payload.max_drawdown) : undefined,
    payout_split_first: payload.payout_split_first !== undefined ? Number(payload.payout_split_first) : undefined,
    payout_split_second: payload.payout_split_second !== undefined ? Number(payload.payout_split_second) : undefined,
    is_active: payload.is_active !== undefined ? !!payload.is_active : undefined,
  };

  updateRowFields_(sheet, row.rowIndex, fieldMap);

  return jsonSuccess_({ success: true });
}

function handleTogglePlanActive(payload) {
  const authErr = requireAdminSession_(payload);
  if (authErr) return authErr;

  const planId = String(payload.plan_id || '');
  if (!planId) return jsonError_('Missing plan_id.');

  const ss    = getSpreadsheet_();
  const sheet = ss.getSheetByName(PLANS_SHEET);
  const row   = findRowByValue_(sheet, 'plan_id', planId);
  if (!row) return jsonError_('Plan not found.');

  updateRowFields_(sheet, row.rowIndex, { is_active: !!payload.is_active });

  return jsonSuccess_({ success: true });
}

// ─────────────────────────────────────────────────────────────────────────
// DISCOUNT CODES
// ─────────────────────────────────────────────────────────────────────────

function handleGetDiscountCodes(payload) {
  const authErr = requireAdminSession_(payload);
  if (authErr) return authErr;

  const ss = getSpreadsheet_();
  const codes = readAllRows_(ss, DISCOUNT_CODES_SHEET).map(normalizeCode_);

  return jsonSuccess_({ success: true, codes: codes });
}

function handleCreatePromoCode(payload) {
  const authErr = requireAdminSession_(payload);
  if (authErr) return authErr;

  const code = String(payload.code || '').trim().toUpperCase();
  const discountPercent = Number(payload.discount_percent);

  if (!code) return jsonError_('Missing code.');
  if (!discountPercent || discountPercent <= 0 || discountPercent > 100) {
    return jsonError_('discount_percent must be between 1 and 100.');
  }

  const ss    = getSpreadsheet_();
  const sheet = ss.getSheetByName(DISCOUNT_CODES_SHEET);

  // Guard against duplicate codes
  if (findRowByValue_(sheet, 'code', code)) {
    return jsonError_('A code with this name already exists.');
  }

  const maxUses = payload.max_uses ? Number(payload.max_uses) : '';

  // Columns: code, type, discount_percent, max_uses, uses_so_far, is_active, created_at
  sheet.appendRow([
    code,
    'promo',
    discountPercent,
    maxUses,
    0,
    true,
    new Date().toISOString(),
  ]);

  return jsonSuccess_({ success: true, code: code });
}

function handleToggleCodeActive(payload) {
  const authErr = requireAdminSession_(payload);
  if (authErr) return authErr;

  const code = String(payload.code || '').trim().toUpperCase();
  if (!code) return jsonError_('Missing code.');

  const ss    = getSpreadsheet_();
  const sheet = ss.getSheetByName(DISCOUNT_CODES_SHEET);
  const row   = findRowByValue_(sheet, 'code', code);
  if (!row) return jsonError_('Code not found.');

  updateRowFields_(sheet, row.rowIndex, { is_active: !!payload.is_active });

  return jsonSuccess_({ success: true });
}

// ─────────────────────────────────────────────────────────────────────────
// USERS
// ─────────────────────────────────────────────────────────────────────────

function handleSearchUsers(payload) {
  const authErr = requireAdminSession_(payload);
  if (authErr) return authErr;

  const query = String(payload.query || '').trim().toLowerCase();
  if (!query) return jsonError_('Missing search query.');

  const ss    = getSpreadsheet_();
  const sheet = ss.getSheetByName(USERS_SHEET_MGMT);
  const data  = sheet.getDataRange().getValues();
  const headers = data[0];

  const idCol   = headers.indexOf('telegram_id');
  const userCol = headers.indexOf('username');

  const matches = [];
  for (let i = 1; i < data.length; i++) {
    const telegramId = String(data[i][idCol]);
    const username   = String(data[i][userCol] || '').toLowerCase();

    if (telegramId.toLowerCase().includes(query) || username.includes(query)) {
      matches.push(headers.reduce((acc, h, idx) => { acc[h] = data[i][idx]; return acc; }, {}));
    }
  }

  return jsonSuccess_({ success: true, users: matches.map(normalizeUser_) });
}

function handleGetUserDetail(payload) {
  const authErr = requireAdminSession_(payload);
  if (authErr) return authErr;

  const telegramId = String(payload.telegram_id || '');
  if (!telegramId) return jsonError_('Missing telegram_id.');

  const ss = getSpreadsheet_();

  const userRow = findRowByValue_(ss.getSheetByName(USERS_SHEET_MGMT), 'telegram_id', telegramId);
  if (!userRow) return jsonError_('User not found.');

  const user = normalizeUser_(rowToObject_(ss.getSheetByName(USERS_SHEET_MGMT), userRow.rowIndex, userRow.values));

  const orders    = readAllRows_(ss, ORDERS_SHEET_MGMT).filter(r => String(r.telegram_id) === telegramId);
  const accounts  = readAllRows_(ss, ACCOUNTS_SHEET_MGMT).filter(r => String(r.telegram_id) === telegramId);
  const ledger    = readAllRows_(ss, POINTS_LEDGER_SHEET).filter(r => String(r.telegram_id) === telegramId);
  const referrals = readAllRows_(ss, REFERRALS_SHEET_MGMT).filter(r => String(r.referrer_telegram_id) === telegramId);

  return jsonSuccess_({
    success: true,
    user: user,
    orders: orders,
    accounts: accounts,
    ledger: ledger,
    referrals: referrals,
  });
}

// ─────────────────────────────────────────────────────────────────────────
// SETTINGS
// ─────────────────────────────────────────────────────────────────────────

function handleGetSettings(payload) {
  const authErr = requireAdminSession_(payload);
  if (authErr) return authErr;

  const ss    = getSpreadsheet_();
  const sheet = ss.getSheetByName(SETTINGS_SHEET_MGMT);
  const data  = sheet.getDataRange().getValues();
  const headers = data[0];
  const keyCol   = headers.indexOf('key');
  const valueCol = headers.indexOf('value');

  const settings = {};
  for (let i = 1; i < data.length; i++) {
    settings[String(data[i][keyCol])] = data[i][valueCol];
  }

  return jsonSuccess_({ success: true, settings: settings });
}

function handleUpdateSettings(payload) {
  const authErr = requireAdminSession_(payload);
  if (authErr) return authErr;

  const updates = payload.settings;
  if (!updates || typeof updates !== 'object') return jsonError_('Missing settings object.');

  const ss    = getSpreadsheet_();
  const sheet = ss.getSheetByName(SETTINGS_SHEET_MGMT);
  const data  = sheet.getDataRange().getValues();
  const headers = data[0];
  const keyCol   = headers.indexOf('key');
  const valueCol = headers.indexOf('value') + 1; // 1-indexed for Range

  Object.keys(updates).forEach(key => {
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][keyCol]) === key) {
        sheet.getRange(i + 1, valueCol).setValue(updates[key]);
        break;
      }
    }
  });

  return jsonSuccess_({ success: true });
}

// ─────────────────────────────────────────────────────────────────────────
// AUTH — shared by every handler in this file
// ─────────────────────────────────────────────────────────────────────────

/**
 * Validates the admin session token on every request.
 * Returns null if valid, or a JSON error response if not — callers should
 * `return` immediately when this returns non-null.
 *
 * NOTE: validateAdminSessionToken_() is expected to live in admin-login.gs
 * (shared across admin-ops.gs and admin-manage.gs). This wrapper just
 * standardizes the error shape both SPAs' frontends expect.
 */
function requireAdminSession_(payload) {
  const token = payload && payload.session;
  if (!token) {
    return jsonError_('unauthorized');
  }

  const valid = validateAdminSessionToken_(token); // defined in admin-login.gs
  if (!valid) {
    return jsonError_('session_expired');
  }

  return null;
}

// ─────────────────────────────────────────────────────────────────────────
// NORMALIZERS
// ─────────────────────────────────────────────────────────────────────────

function normalizePlan_(obj) {
  return {
    plan_id: String(obj.plan_id),
    name: String(obj.name),
    account_size: Number(obj.account_size),
    price_usd: Number(obj.price_usd),
    phase1_target: Number(obj.phase1_target),
    phase2_target: Number(obj.phase2_target),
    max_drawdown: Number(obj.max_drawdown),
    payout_split_first: Number(obj.payout_split_first),
    payout_split_second: Number(obj.payout_split_second),
    is_active: obj.is_active === true || obj.is_active === 'true' || obj.is_active === 'TRUE',
  };
}

function normalizeCode_(obj) {
  return {
    code: String(obj.code),
    type: String(obj.type),
    discount_percent: Number(obj.discount_percent),
    max_uses: obj.max_uses === '' ? null : Number(obj.max_uses),
    uses_so_far: Number(obj.uses_so_far || 0),
    is_active: obj.is_active === true || obj.is_active === 'true' || obj.is_active === 'TRUE',
    created_at: normalizeDate_(obj.created_at),
  };
}

function normalizeUser_(obj) {
  return {
    telegram_id: String(obj.telegram_id),
    username: obj.username ? String(obj.username) : '',
    first_name: obj.first_name ? String(obj.first_name) : '',
    referral_code: obj.referral_code ? String(obj.referral_code) : '',
    referred_by: obj.referred_by ? String(obj.referred_by) : '',
    points_balance: Number(obj.points_balance || 0),
    join_date: normalizeDate_(obj.join_date),
    onboarding_complete: obj.onboarding_complete === true || obj.onboarding_complete === 'true',
  };
}

function normalizeDate_(value) {
  if (value instanceof Date) return value.toISOString();
  return value ? String(value) : '';
}

// ─────────────────────────────────────────────────────────────────────────
// SHEET HELPERS
// ─────────────────────────────────────────────────────────────────────────

/** Reads every data row of a sheet into an array of plain objects keyed by header. */
function readAllRows_(ss, sheetName) {
  const sheet = ss.getSheetByName(sheetName);
  const data  = sheet.getDataRange().getValues();
  const headers = data[0];

  const rows = [];
  for (let i = 1; i < data.length; i++) {
    rows.push(headers.reduce((acc, h, idx) => { acc[h] = data[i][idx]; return acc; }, {}));
  }
  return rows;
}

/** Finds a row by matching a column's value. Returns { rowIndex, values } or null. 1-indexed rowIndex for Range use. */
function findRowByValue_(sheet, columnName, value) {
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const col = headers.indexOf(columnName);
  if (col === -1) return null;

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][col]) === String(value)) {
      return { rowIndex: i + 1, values: data[i] };
    }
  }
  return null;
}

function rowToObject_(sheet, rowIndex, values) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  return headers.reduce((acc, h, idx) => { acc[h] = values[idx]; return acc; }, {});
}

/** Updates only the given fields on a row by column name — never overwrites headers, never touches other columns. */
function updateRowFields_(sheet, rowIndex, fieldMap) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];

  Object.keys(fieldMap).forEach(key => {
    if (fieldMap[key] === undefined) return; // skip unset fields
    const col = headers.indexOf(key);
    if (col === -1) return;
    sheet.getRange(rowIndex, col + 1).setValue(fieldMap[key]);
  });
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
