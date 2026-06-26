// ============================================================
//  points.gs
//  NowFunded — Points & Referrals backend
//  Actions: getPoints, redeemPoints
// ============================================================

/**
 * Entry point — called by the shared doPost router in index.gs.
 * Supported actions:
 *   getPoints    — returns balance, full ledger, referral info, shop items
 *   redeemPoints — spends points to generate a discount code for the trader
 */
function handlePoints(payload) {
  const action = payload.action;

  if (action === 'getPoints')    return getPoints(payload);
  if (action === 'redeemPoints') return redeemPoints(payload);

  return { error: 'Unknown points action: ' + action };
}


// ─── getPoints ───────────────────────────────────────────────────────────────

/**
 * Returns everything the Points screen needs in one call:
 * {
 *   success: true,
 *   points_balance:    number,
 *   referral_code:     string,
 *   points_per_referral: number,      // from Settings
 *   ledger:   [ { ledger_id, type, reason, points, created_at } ],
 *   referrals:[ { referral_id, referred_username, status, converted_at } ],
 *   shop_items: [ { code, name, discount_percent, points_cost, is_active } ]
 * }
 */
function getPoints(payload) {
  const telegramId = String(payload.telegram_id || '').trim();
  if (!telegramId) return { error: 'telegram_id required' };

  const ss = SpreadsheetApp.openById(
    PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID')
  );

  // ── Points balance + referral code from Users ────────────────────────────
  const usersSheet = ss.getSheetByName('Users');
  const usersData  = usersSheet.getDataRange().getValues();
  const usersHdr   = usersData[0];
  const colU       = makeColMap(usersHdr);

  let pointsBalance = 0;
  let referralCode  = '';

  for (let r = 1; r < usersData.length; r++) {
    if (String(usersData[r][colU.telegram_id]) === telegramId) {
      pointsBalance = Number(usersData[r][colU.points_balance]) || 0;
      referralCode  = String(usersData[r][colU.referral_code]  || '');
      break;
    }
  }

  // ── PointsLedger ─────────────────────────────────────────────────────────
  const ledgerSheet = ss.getSheetByName('PointsLedger');
  const ledgerData  = ledgerSheet.getDataRange().getValues();
  const ledgerHdr   = ledgerData[0];
  const colL        = makeColMap(ledgerHdr);

  const ledger = [];
  for (let r = 1; r < ledgerData.length; r++) {
    const row = ledgerData[r];
    if (String(row[colL.telegram_id]) !== telegramId) continue;
    ledger.push({
      ledger_id:   row[colL.ledger_id],
      type:        row[colL.type]       || '',
      reason:      row[colL.reason]     || '',
      points:      Number(row[colL.points]) || 0,
      reference_id:row[colL.reference_id] || '',
      created_at:  row[colL.created_at] || '',
    });
  }

  // Most recent first
  ledger.sort((a, b) => (b.created_at > a.created_at ? 1 : -1));

  // ── Referrals ─────────────────────────────────────────────────────────────
  const referralsSheet = ss.getSheetByName('Referrals');
  const referralsData  = referralsSheet.getDataRange().getValues();
  const referralsHdr   = referralsData[0];
  const colR           = makeColMap(referralsHdr);

  // We need usernames for referred traders — build a lookup from Users
  const usernameMap = {};
  for (let r = 1; r < usersData.length; r++) {
    const tid = String(usersData[r][colU.telegram_id]);
    usernameMap[tid] = usersData[r][colU.username]   ||
                       usersData[r][colU.first_name]  ||
                       tid;
  }

  const referrals = [];
  for (let r = 1; r < referralsData.length; r++) {
    const row = referralsData[r];
    if (String(row[colR.referrer_telegram_id]) !== telegramId) continue;
    const referredId = String(row[colR.referred_telegram_id]);
    referrals.push({
      referral_id:        row[colR.referral_id],
      referred_telegram_id: referredId,
      referred_username:  usernameMap[referredId] || 'Trader',
      status:             row[colR.status]        || 'pending',
      converted_at:       row[colR.converted_at]  || '',
      points_awarded:     Number(row[colR.points_awarded]) || 0,
    });
  }

  // Most recent first
  referrals.sort((a, b) => {
    const ta = a.converted_at || '';
    const tb = b.converted_at || '';
    return tb > ta ? 1 : -1;
  });

  // ── Points shop items from DiscountCodes (type = points_shop) ────────────
  const codesSheet = ss.getSheetByName('DiscountCodes');
  const codesData  = codesSheet.getDataRange().getValues();
  const codesHdr   = codesData[0];
  const colC       = makeColMap(codesHdr);

  const shopItems = [];
  for (let r = 1; r < codesData.length; r++) {
    const row  = codesData[r];
    const type = String(row[colC.type] || '').toLowerCase();
    if (type !== 'points_shop') continue;

    const isActive  = String(row[colC.is_active]).toLowerCase() === 'true';
    const maxUses   = Number(row[colC.max_uses])    || 0;
    const usedSoFar = Number(row[colC.uses_so_far]) || 0;
    if (!isActive || (maxUses > 0 && usedSoFar >= maxUses)) continue;

    shopItems.push({
      code:             String(row[colC.code]),
      name:             String(row[colC.name]             || row[colC.code]),
      discount_percent: Number(row[colC.discount_percent]) || 0,
      points_cost:      Number(row[colC.points_cost]       || 0),
      is_active:        true,
    });
  }

  // ── points_per_referral from Settings ────────────────────────────────────
  const settingsSheet = ss.getSheetByName('Settings');
  const settingsData  = settingsSheet.getDataRange().getValues();
  const settingsHdr   = settingsData[0];
  const colS          = makeColMap(settingsHdr);

  let pointsPerReferral = 0;
  for (let r = 1; r < settingsData.length; r++) {
    if (String(settingsData[r][colS.key]) === 'points_per_referral') {
      pointsPerReferral = Number(settingsData[r][colS.value]) || 0;
      break;
    }
  }

  return {
    success:             true,
    points_balance:      pointsBalance,
    referral_code:       referralCode,
    points_per_referral: pointsPerReferral,
    ledger,
    referrals,
    shop_items:          shopItems,
  };
}


// ─── redeemPoints ────────────────────────────────────────────────────────────

/**
 * Redeems points for a discount code from the points shop.
 *
 * Validates:
 *   - shop_code exists, is type = points_shop, is active, has uses remaining
 *   - trader has enough points_balance
 *
 * On success:
 *   - Deducts points from Users.points_balance
 *   - Logs a spend entry in PointsLedger
 *   - Increments uses_so_far on the DiscountCode
 *   - Returns the discount code string for display
 *
 * Response: { success: true, discount_code: string }
 */
function redeemPoints(payload) {
  const telegramId = String(payload.telegram_id || '').trim();
  const shopCode   = String(payload.shop_code   || '').trim();

  if (!telegramId) return { error: 'telegram_id required' };
  if (!shopCode)   return { error: 'shop_code required' };

  const ss = SpreadsheetApp.openById(
    PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID')
  );

  // ── Find the shop item ────────────────────────────────────────────────────
  const codesSheet = ss.getSheetByName('DiscountCodes');
  const codesData  = codesSheet.getDataRange().getValues();
  const codesHdr   = codesData[0];
  const colC       = makeColMap(codesHdr);

  let codeRowIndex   = -1;
  let codeRow        = null;
  let pointsCost     = 0;
  let discountPercent= 0;
  let codeName       = '';

  for (let r = 1; r < codesData.length; r++) {
    const row  = codesData[r];
    if (String(row[colC.code]) !== shopCode) continue;
    if (String(row[colC.type] || '').toLowerCase() !== 'points_shop') continue;

    const isActive  = String(row[colC.is_active]).toLowerCase() === 'true';
    const maxUses   = Number(row[colC.max_uses])    || 0;
    const usedSoFar = Number(row[colC.uses_so_far]) || 0;

    if (!isActive)                           return { error: 'This item is no longer available.' };
    if (maxUses > 0 && usedSoFar >= maxUses) return { error: 'This item is sold out.' };

    codeRowIndex    = r + 1;  // 1-based
    codeRow         = row;
    pointsCost      = Number(row[colC.points_cost])      || 0;
    discountPercent = Number(row[colC.discount_percent])  || 0;
    codeName        = String(row[colC.name] || row[colC.code]);
    break;
  }

  if (codeRowIndex === -1) return { error: 'Item not found in the shop.' };

  // ── Find and validate the trader ─────────────────────────────────────────
  const usersSheet = ss.getSheetByName('Users');
  const usersData  = usersSheet.getDataRange().getValues();
  const usersHdr   = usersData[0];
  const colU       = makeColMap(usersHdr);

  let userRowIndex   = -1;
  let currentBalance = 0;

  for (let r = 1; r < usersData.length; r++) {
    if (String(usersData[r][colU.telegram_id]) === telegramId) {
      userRowIndex   = r + 1;  // 1-based
      currentBalance = Number(usersData[r][colU.points_balance]) || 0;
      break;
    }
  }

  if (userRowIndex === -1) return { error: 'User not found.' };
  if (currentBalance < pointsCost) {
    return { error: `Not enough points. You need ${pointsCost} pts but have ${currentBalance}.` };
  }

  // ── Deduct points from Users ──────────────────────────────────────────────
  const newBalance  = currentBalance - pointsCost;
  const balanceCol  = colU.points_balance + 1;  // convert to 1-based column
  usersSheet.getRange(userRowIndex, balanceCol).setValue(newBalance);

  // ── Log spend in PointsLedger ─────────────────────────────────────────────
  const ledgerSheet = ss.getSheetByName('PointsLedger');
  const ledgerId    = 'LDG-' + Date.now();
  ledgerSheet.appendRow([
    ledgerId,                         // ledger_id
    telegramId,                        // telegram_id
    'spend',                           // type
    'Redeemed: ' + codeName,           // reason
    -pointsCost,                       // points (negative = spend)
    shopCode,                          // reference_id
    new Date().toISOString(),          // created_at
  ]);

  // ── Increment uses_so_far on DiscountCode ─────────────────────────────────
  const usesCol     = colC.uses_so_far + 1;  // 1-based
  const currentUses = Number(codeRow[colC.uses_so_far]) || 0;
  codesSheet.getRange(codeRowIndex, usesCol).setValue(currentUses + 1);

  return {
    success:       true,
    discount_code: shopCode,
    new_balance:   newBalance,
  };
}


// ─── Shared helper ───────────────────────────────────────────────────────────

/**
 * Builds a column-name → zero-based index map from a header row.
 */
function makeColMap(headerRow) {
  const map = {};
  headerRow.forEach((h, i) => {
    const key = String(h).trim().toLowerCase().replace(/\s+/g, '_');
    map[key] = i;
  });
  return map;
}
