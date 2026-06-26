// notifications.gs
// All Telegram Bot notification functions for NowFunded.
// Never called directly — imported and called by other .gs files.
// Reads BOT_TOKEN and ADMIN_TELEGRAM_ID from Script Properties only.

// ─────────────────────────────────────────────
// INTERNAL HELPER
// ─────────────────────────────────────────────

function _sendTelegramMessage(chatId, text) {
  var token = PropertiesService.getScriptProperties().getProperty("BOT_TOKEN");
  if (!token) {
    Logger.log("ERROR: BOT_TOKEN not set in Script Properties.");
    return;
  }
  var url = "https://api.telegram.org/bot" + token + "/sendMessage";
  var payload = {
    chat_id: String(chatId),
    text: text,
    parse_mode: "HTML"
  };
  var options = {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };
  try {
    var response = UrlFetchApp.fetch(url, options);
    var result = JSON.parse(response.getContentText());
    if (!result.ok) {
      Logger.log("Telegram API error: " + response.getContentText());
    }
  } catch (e) {
    Logger.log("Failed to send Telegram message: " + e.message);
  }
}


// ─────────────────────────────────────────────
// TRADER NOTIFICATIONS
// ─────────────────────────────────────────────

/**
 * Payment confirmed — credentials coming soon.
 * @param {string} telegramId
 */
function notifyPaymentConfirmed(telegramId) {
  var text =
    "✅ <b>Payment Confirmed</b>\n\n" +
    "Your payment has been verified. We're now preparing your MT5 credentials — " +
    "you'll receive them shortly. Good luck on your challenge! 🚀";
  _sendTelegramMessage(telegramId, text);
}

/**
 * MT5 credentials issued to trader.
 * @param {string} telegramId
 * @param {string} login
 * @param {string} password
 * @param {string} server
 */
function notifyCredentialsIssued(telegramId, login, password, server) {
  var text =
    "🖥️ <b>Your MT5 Credentials Are Ready</b>\n\n" +
    "Log in to your trading account using the details below:\n\n" +
    "<b>Login:</b> " + login + "\n" +
    "<b>Password:</b> " + password + "\n" +
    "<b>Server:</b> " + server + "\n\n" +
    "Head to your dashboard to track your progress. Trade well! 📈";
  _sendTelegramMessage(telegramId, text);
}

/**
 * Trader passed a phase — next phase credentials coming.
 * @param {string} telegramId
 * @param {number|string} phase — the phase just passed (1 or 2)
 */
function notifyPhasePassed(telegramId, phase) {
  var next = parseInt(phase) + 1;
  var nextLabel = next === 2 ? "Phase 2" : "Funded Account";
  var text =
    "🏆 <b>Phase " + phase + " Passed!</b>\n\n" +
    "Congratulations — you've cleared Phase " + phase + ". " +
    "Your " + nextLabel + " credentials are being prepared and will be sent to you shortly.\n\n" +
    "Keep the momentum going! 💪";
  _sendTelegramMessage(telegramId, text);
}

/**
 * Trader breached an account at Phase 1 or 2 — fee lost, no reset.
 * @param {string} telegramId
 * @param {number|string} phase
 */
function notifyPhaseBreached(telegramId, phase) {
  var text =
    "❌ <b>Phase " + phase + " Account Breached</b>\n\n" +
    "Unfortunately your Phase " + phase + " account has been marked as breached. " +
    "Your challenge fee has been lost and no reset is available for this account.\n\n" +
    "You can start a new challenge from the Marketplace whenever you're ready.";
  _sendTelegramMessage(telegramId, text);
}

/**
 * Funded/scaled account blown — includes points refund message if applicable.
 * @param {string} telegramId
 * @param {number|null} pointsRefunded — pass 0 or null if no refund
 */
function notifyAccountBlown(telegramId, pointsRefunded) {
  var refundLine = (pointsRefunded && pointsRefunded > 0)
    ? "\n\nAs a goodwill gesture, <b>" + pointsRefunded + " points</b> have been added to your account. " +
      "You can use them in the Points Shop for a discount on your next challenge."
    : "";
  var text =
    "💥 <b>Account Blown</b>\n\n" +
    "Your funded account has been marked as blown." +
    refundLine + "\n\n" +
    "Head to the Marketplace to start a new challenge whenever you're ready.";
  _sendTelegramMessage(telegramId, text);
}

/**
 * Payout approved — confirms amount and wallet.
 * @param {string} telegramId
 * @param {number|string} amount
 * @param {string} wallet
 */
function notifyPayoutApproved(telegramId, amount, wallet) {
  var text =
    "💸 <b>Payout Approved</b>\n\n" +
    "Your payout of <b>$" + amount + "</b> has been approved and will be sent to:\n" +
    "<code>" + wallet + "</code>\n\n" +
    "Please allow some time for the transfer to process. Thank you for trading with NowFunded!";
  _sendTelegramMessage(telegramId, text);
}

/**
 * Payout rejected.
 * @param {string} telegramId
 */
function notifyPayoutRejected(telegramId) {
  var text =
    "⚠️ <b>Payout Request Rejected</b>\n\n" +
    "Your payout request has been rejected. Please open a support ticket if you have " +
    "any questions and our team will assist you.";
  _sendTelegramMessage(telegramId, text);
}

/**
 * Second payout approved — trader is now eligible for scale-up.
 * @param {string} telegramId
 */
function notifyScaleUpAvailable(telegramId) {
  var text =
    "🚀 <b>Scale-Up Available!</b>\n\n" +
    "Your second payout has been approved — you've unlocked a scale-up on your funded account. " +
    "Our team is processing this now and will be in touch with your upgraded account details shortly.\n\n" +
    "Excellent trading! 🏅";
  _sendTelegramMessage(telegramId, text);
}

/**
 * Admin replied to trader's support thread.
 * @param {string} telegramId
 */
function notifySupportReply(telegramId) {
  var text =
    "💬 <b>New Reply in Support</b>\n\n" +
    "Our support team has replied to your ticket. " +
    "Open the NowFunded app to view the message and continue the conversation.";
  _sendTelegramMessage(telegramId, text);
}


// ─────────────────────────────────────────────
// ADMIN NOTIFICATIONS
// ─────────────────────────────────────────────

/**
 * New order pending admin confirmation.
 * @param {string} orderId
 * @param {string} username
 * @param {string} planName
 * @param {number|string} amount
 */
function notifyAdminNewOrder(orderId, username, planName, amount) {
  var adminId = PropertiesService.getScriptProperties().getProperty("ADMIN_TELEGRAM_ID");
  if (!adminId) {
    Logger.log("ERROR: ADMIN_TELEGRAM_ID not set in Script Properties.");
    return;
  }
  var text =
    "🔔 <b>New Order — Action Required</b>\n\n" +
    "<b>Order ID:</b> " + orderId + "\n" +
    "<b>Trader:</b> @" + username + "\n" +
    "<b>Plan:</b> " + planName + "\n" +
    "<b>Amount:</b> $" + amount + "\n\n" +
    "Review and confirm in the Admin panel → Orders.";
  _sendTelegramMessage(adminId, text);
}

/**
 * New payout request pending admin review.
 * @param {string} payoutId
 * @param {string} username
 * @param {number|string} amount
 */
function notifyAdminNewPayout(payoutId, username, amount) {
  var adminId = PropertiesService.getScriptProperties().getProperty("ADMIN_TELEGRAM_ID");
  if (!adminId) {
    Logger.log("ERROR: ADMIN_TELEGRAM_ID not set in Script Properties.");
    return;
  }
  var text =
    "💰 <b>New Payout Request — Action Required</b>\n\n" +
    "<b>Payout ID:</b> " + payoutId + "\n" +
    "<b>Trader:</b> @" + username + "\n" +
    "<b>Amount:</b> $" + amount + "\n\n" +
    "Review and approve in the Admin panel → Payouts.";
  _sendTelegramMessage(adminId, text);
}

/**
 * New support thread opened by a trader.
 * @param {string} threadId
 * @param {string} username
 */
function notifyAdminNewSupport(threadId, username) {
  var adminId = PropertiesService.getScriptProperties().getProperty("ADMIN_TELEGRAM_ID");
  if (!adminId) {
    Logger.log("ERROR: ADMIN_TELEGRAM_ID not set in Script Properties.");
    return;
  }
  var text =
    "🎫 <b>New Support Thread</b>\n\n" +
    "<b>Thread ID:</b> " + threadId + "\n" +
    "<b>Trader:</b> @" + username + "\n\n" +
    "View and reply in the Admin panel → Support.";
  _sendTelegramMessage(adminId, text);
}

/**
 * Scale-up is ready for admin to action on an account.
 * @param {string} accountId
 * @param {string} username
 */
function notifyAdminScaleUpReady(accountId, username) {
  var adminId = PropertiesService.getScriptProperties().getProperty("ADMIN_TELEGRAM_ID");
  if (!adminId) {
    Logger.log("ERROR: ADMIN_TELEGRAM_ID not set in Script Properties.");
    return;
  }
  var text =
    "⚡ <b>Scale-Up Ready — Action Required</b>\n\n" +
    "<b>Account ID:</b> " + accountId + "\n" +
    "<b>Trader:</b> @" + username + "\n\n" +
    "This trader has completed their second payout and is eligible for a scale-up. " +
    "Action this in the Admin panel → Accounts.";
  _sendTelegramMessage(adminId, text);
}
