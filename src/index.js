import { tg } from "./lib/telegram.js";
import { getState, clearState } from "./lib/state.js";
import { getUser, getActiveServiceIndex, getService, saveService, getPanel, getTexts, getSettings } from "./lib/kv.js";
import { adapterFor } from "./lib/panels/index.js";
import { loadRuntimeSettings } from "./lib/styles.js";
import { supportReply } from "./lib/ai.js";

import { handleStart, handleJoinCheck, handleRulesAccept, handleContact } from "./handlers/start.js";
import { sendMainMenu, checkJoined, sendJoinPrompt } from "./handlers/menu.js";
import { showTestMenu, handleTestGet } from "./handlers/test.js";
import * as purchase from "./handlers/purchase.js";
import * as wallet from "./handlers/wallet.js";
import { showReferral } from "./handlers/referral.js";
import * as services from "./handlers/services.js";
import * as support from "./handlers/support.js";

import { requireAdmin, showAdminMenu } from "./handlers/admin/index.js";
import * as adminUsers from "./handlers/admin/users.js";
import * as adminProducts from "./handlers/admin/products.js";
import * as adminCategories from "./handlers/admin/categories.js";
import * as adminPanels from "./handlers/admin/panels.js";
import * as adminProfiles from "./handlers/admin/profiles.js";
import * as adminDiscounts from "./handlers/admin/discounts.js";
import * as adminPayments from "./handlers/admin/payments.js";
import * as adminBroadcast from "./handlers/admin/broadcast.js";
import * as adminAdmins from "./handlers/admin/admins.js";
import * as adminChannels from "./handlers/admin/channels.js";
import * as adminSettings from "./handlers/admin/settings.js";
import * as adminFaq from "./handlers/admin/faq.js";
import * as adminStats from "./handlers/admin/stats.js";
import * as adminTickets from "./handlers/admin/tickets.js";
import { showWalletAdminMenu } from "./handlers/admin/walletAdmin.js";
import * as adminManualSale from "./handlers/admin/manualSale.js";

export default {
  async fetch(request, env, ctx) {
    if (request.method !== "POST") {
      return new Response("VPN Shop Bot is running.", { status: 200 });
    }

    const secret = request.headers.get("X-Telegram-Bot-Api-Secret-Token");
    if (env.WEBHOOK_SECRET && secret !== env.WEBHOOK_SECRET) {
      return new Response("forbidden", { status: 403 });
    }

    let update;
    try {
      update = await request.json();
    } catch {
      return new Response("bad request", { status: 400 });
    }

    const telegram = tg(env);

    try {
      const settings = await loadRuntimeSettings(env.BOT_KV);

      if (settings.bot_enabled === false) {
        const fromId = update.message?.from?.id || update.callback_query?.from?.id;
        const role = fromId ? await requireAdmin(env, fromId) : null;
        if (!role) {
          const texts = await getTexts(env.BOT_KV);
          if (update.message) {
            await telegram.sendMessage(update.message.chat.id, texts.bot_off);
          } else if (update.callback_query) {
            await telegram.answerCallbackQuery(update.callback_query.id, texts.bot_off, true);
          }
          return new Response("ok", { status: 200 });
        }
      }

      if (update.message) {
        await onMessage(env, telegram, update.message, ctx);
      } else if (update.callback_query) {
        await onCallback(env, telegram, update.callback_query);
      }
    } catch (err) {
      console.log("UNHANDLED ERROR", err && err.stack ? err.stack : err);
    }

    return new Response("ok", { status: 200 });
  },

  async scheduled(event, env, ctx) {
    const telegram = tg(env);
    await loadRuntimeSettings(env.BOT_KV);
    await sweepExpiredServices(env, telegram);
  },
};

async function sweepExpiredServices(env, telegram) {
  const kv = env.BOT_KV;
  const ids = await getActiveServiceIndex(kv);
  const now = Date.now();

  for (const id of ids) {
    const service = await getService(kv, id);
    if (!service || service.status === "disabled") continue;

    const msLeft = service.expires_at - now;

    if (msLeft <= 0) {
      service.status = "disabled";
      await saveService(kv, service);

      const panel = await getPanel(kv, service.panel_id);

      if (panel) {
        try {
          const adapter = adapterFor(panel);
          if (adapter.disableUser) {
            await adapter.disableUser(panel, service.username);
          }
        } catch (e) {
          console.log("disable expired service failed", service.id, e);
        }
      }

      await telegram.sendMessage(
        service.user_id,
        `🔴 سرویس #${service.id} شما منقضی شد.`
      );
    } else if (
      msLeft <=
        (await getSettings(kv)).expiry_warning_hours * 3600 * 1000 &&
      !service.warned_24h
    ) {
      service.warned_24h = true;
      await saveService(kv, service);

      await telegram.sendMessage(
        service.user_id,
        `⚠️ سرویس #${service.id} شما 24 ساعت دیگر منقضی می‌شود.`
      );
    }
  }
}

// ---------------- messages (text / photo) ----------------

async function onMessage(env, telegram, message, ctx) {
  const chatId = message.chat.id;
  const userId = message.from.id;
  const text = message.text || "";

  if (text.startsWith("/start")) {
    return handleStart(env, telegram, message);
  }

  if (message.contact) {
    return handleContact(env, telegram, message);
  }

  if (text.startsWith("/admin")) {
    const role = await requireAdmin(env, userId);
    if (!role) return;

    return showAdminMenu(env, telegram, chatId, null, role);
  }

  const adminRole = await requireAdmin(env, userId);

  const user = await getUser(env.BOT_KV, userId);
  if (user && user.banned && !adminRole) return;

  if (user && !adminRole) {
    const joinStatus = await checkJoined(env, telegram, userId);

    if (!joinStatus.ok) {
      return sendJoinPrompt(
        env,
        telegram,
        chatId,
        joinStatus.missing
      );
    }
  }

  const state = await getState(env, userId);
  if (!state) return;

  switch (state.step) {
    case "await_discount_code":
      return purchase.handleDiscountCodeInput(
        env,
        telegram,
        message,
        state
      );

    case "await_custom_amount":
      return wallet.handleCustomAmountInput(
        env,
        telegram,
        message
      );

    case "await_card_last4":
      return wallet.handleCardLast4Input(
        env,
        telegram,
        message,
        state
      );

    case "await_receipt_photo":
      if (!message.photo) {
        const texts = await getTexts(env.BOT_KV);

        return telegram.sendMessage(
          chatId,
          texts.wallet_receipt_need_photo
        );
      }

      ctx.waitUntil(
        wallet
          .handleReceiptPhoto(
            env,
            telegram,
            message,
            state
          )
          .catch((e) => {
            console.log(
              "RECEIPT PROCESSING ERROR",
              e?.stack || e
            );
          })
      );

      return;

    case "await_ticket_message":
      return support.handleTicketMessageInput(
        env,
        telegram,
        message,
        state
      );

    // ---- admin text-input steps ----
    case "admin_search_user":
      return adminUsers.handleSearchInput(
        env,
        telegram,
        message
      );

    case "admin_balance_amount":
      return adminUsers.handleBalanceAmountInput(
        env,
        telegram,
        message,
        state
      );

    case "admin_add_category":
    case "admin_rename_category":
      return adminCategories.handleCategoryTextInput(
        env,
        telegram,
        message,
        state
      );

    case "admin_add_product_name":
    case "admin_add_product_price":
    case "admin_add_product_volume":
    case "admin_add_product_days":
    case "admin_add_product_protocol":
    case "admin_add_product_desc":
      return adminProducts.handleProductTextInput(
        env,
        telegram,
        message,
        state
      );

    case "admin_edit_product_field":
      return adminProducts.handleProductEditInput(
        env,
        telegram,
        message,
        state
      );

    case "admin_add_panel_name":
    case "admin_add_panel_url":
    case "admin_add_panel_user":
    case "admin_add_panel_pass":
      return adminPanels.handlePanelTextInput(
        env,
        telegram,
        message,
        state
      );

    case "admin_add_profile_name":
      return adminProfiles.handleProfileTextInput(
        env,
        telegram,
        message,
        state
      );

    case "admin_add_disc_code":
    case "admin_add_disc_value":
    case "admin_add_disc_maxuses":
    case "admin_add_disc_days":
      return adminDiscounts.handleDiscountTextInput(
        env,
        telegram,
        message,
        state
      );

    case "admin_broadcast_message":
      return adminBroadcast.handleBroadcastContent(
        env,
        telegram,
        message,
        state
      );

    case "admin_broadcast_buttons":
      return adminBroadcast.handleBroadcastButtons(
        env,
        telegram,
        message,
        state
      );

    case "admin_add_admin_id":
      return adminAdmins.handleAdminIdInput(
        env,
        telegram,
        message
      );

    case "admin_manual_sale_user":
      return adminManualSale.handleUser(
        env,
        telegram,
        message
      );

    case "admin_add_chan_name":
    case "admin_add_chan_id":
    case "admin_add_chan_url":
      return adminChannels.handleChannelTextInput(
        env,
        telegram,
        message,
        state
      );

    case "admin_set_field":
      return adminSettings.handleSettingValueInput(
        env,
        telegram,
        message,
        state
      );

    case "admin_set_text":
      return adminSettings.handleTextValueInput(
        env,
        telegram,
        message,
        state
      );

    case "admin_set_emoji":
      return adminSettings.handleEmojiValueInput(
        env,
        telegram,
        message,
        state
      );

    case "admin_set_ai_key":
      return adminSettings.handleAIKeyInput(
        env,
        telegram,
        message,
        state
      );

    case "admin_log_forward":
      return adminSettings.handleLogGroupForward(
        env,
        telegram,
        message,
        state
      );

    case "admin_faq_add_q":
    case "admin_faq_add_a":
      return adminFaq.handleFaqAddInput(
        env,
        telegram,
        message,
        state
      );

    case "admin_faq_edit":
      return adminFaq.handleFaqEditInput(
        env,
        telegram,
        message,
        state
      );

    case "admin_ticket_reply":
      return adminTickets.handleTicketReplyInput(
        env,
        telegram,
        message,
        state
      );

    default:
      break;
  }

  if (adminRole) {
    const handled = await handleAdminTextFallback(
      env,
      telegram,
      message,
      state,
      adminRole
    );

    if (handled) return;
  }

  if (text) {
    const reply = await supportReply(
      env,
      text,
      user
    );

    if (reply) {
      return telegram.sendMessage(chatId, reply);
    }
  }
}

// ---------------- callbacks ----------------

async function onCallback(env, telegram, q) {
  const chatId = q.message?.chat?.id;
  const messageId = q.message?.message_id;
  const userId = q.from?.id;
  const data = q.data || "";

  if (!chatId || !userId) {
    try {
      await telegram.answerCallbackQuery(q.id);
    } catch {}
    return;
  }

  const ack = async (text = "") => {
    try {
      await telegram.answerCallbackQuery(q.id, text);
    } catch {}
  };

  if (data === "start:joincheck") {
    await ack();
    return handleJoinCheck(
      env,
      telegram,
      chatId,
      messageId,
      userId
    );
  }

  if (data === "start:rules") {
    await ack();
    return handleRulesAccept(
      env,
      telegram,
      chatId,
      messageId,
      userId
    );
  }

  if (data === "menu:main") {
    await ack();
    return sendMainMenu(
      env,
      telegram,
      chatId,
      messageId,
      userId
    );
  }

  if (data === "menu:test") {
    await ack();
    return showTestMenu(
      env,
      telegram,
      chatId,
      messageId,
      userId
    );
  }

  if (data === "test:get") {
    await ack();
    return handleTestGet(
      env,
      telegram,
      chatId,
      messageId,
      userId
    );
  }

  if (data === "menu:services") {
    await ack();
    return services.showServices(
      env,
      telegram,
      chatId,
      messageId,
      userId
    );
  }

  if (data === "menu:wallet") {
    await ack();
    return wallet.showWallet(
      env,
      telegram,
      chatId,
      messageId,
      userId
    );
  }

  if (data === "menu:referral") {
    await ack();
    return showReferral(
      env,
      telegram,
      chatId,
      messageId,
      userId
    );
  }

  if (data === "menu:support") {
    await ack();
    return support.showSupport(
      env,
      telegram,
      chatId,
      messageId,
      userId
    );
  }

  if (data === "wallet:charge") {
    await ack();
    return wallet.showChargeOptions(
      env,
      telegram,
      chatId,
      messageId
    );
  }

  if (data === "wallet:charge:card") {
    await ack();
    return wallet.showCardToCard(
      env,
      telegram,
      chatId,
      messageId
    );
  }

  if (data === "wallet:charge:gateway") {
    await ack();
    return wallet.showGatewayNotice(
      env,
      telegram,
      chatId,
      messageId
    );
  }

  if (data.startsWith("wallet:amt:")) {
    await ack();

    const amountToken = data.slice("wallet:amt:".length);

    return wallet.handleAmountChosen(
      env,
      telegram,
      chatId,
      messageId,
      userId,
      amountToken
    );
  }

  if (data === "wallet:tx") {
    await ack();
    return wallet.showTransactions(
      env,
      telegram,
      chatId,
      messageId,
      userId
    );
  }

  if (data.startsWith("purchase:")) {
    await ack();

    return purchase.handleCallback(
      env,
      telegram,
      chatId,
      messageId,
      userId,
      data
    );
  }

  if (data.startsWith("service:")) {
    await ack();

    return services.handleCallback(
      env,
      telegram,
      chatId,
      messageId,
      userId,
      data
    );
  }

  if (data.startsWith("support:")) {
    await ack();

    return support.handleCallback(
      env,
      telegram,
      chatId,
      messageId,
      userId,
      data
    );
  }

  // ---------------- admin ----------------

  const role = await requireAdmin(env, userId);

  if (!role) {
    await ack("دسترسی ندارید");
    return;
  }

  if (data === "admin:main") {
    await ack();

    return showAdminMenu(
      env,
      telegram,
      chatId,
      messageId,
      role
    );
  }

  if (data === "admin:users") {
    await ack();

    return adminUsers.showUsers(
      env,
      telegram,
      chatId,
      messageId,
      role
    );
  }

  if (data.startsWith("admin:user:")) {
    await ack();

    return adminUsers.handleCallback(
      env,
      telegram,
      chatId,
      messageId,
      userId,
      data,
      role
    );
  }

  if (data === "admin:products") {
    await ack();

    return adminProducts.showProducts(
      env,
      telegram,
      chatId,
      messageId,
      role
    );
  }

  if (data.startsWith("admin:product:")) {
    await ack();

    return adminProducts.handleCallback(
      env,
      telegram,
      chatId,
      messageId,
      userId,
      data,
      role
    );
  }

  if (data === "admin:categories") {
    await ack();

    return adminCategories.showCategories(
      env,
      telegram,
      chatId,
      messageId,
      role
    );
  }

  if (data.startsWith("admin:category:")) {
    await ack();

    return adminCategories.handleCallback(
      env,
      telegram,
      chatId,
      messageId,
      userId,
      data,
      role
    );
  }

  if (data === "admin:panels") {
    await ack();

    return adminPanels.showPanels(
      env,
      telegram,
      chatId,
      messageId,
      role
    );
  }

  if (data.startsWith("admin:panel:")) {
    await ack();

    return adminPanels.handleCallback(
      env,
      telegram,
      chatId,
      messageId,
      userId,
      data,
      role
    );
  }

  if (data === "admin:profiles") {
    await ack();

    return adminProfiles.showProfiles(
      env,
      telegram,
      chatId,
      messageId,
      role
    );
  }

  if (data.startsWith("admin:profile:")) {
    await ack();

    return adminProfiles.handleCallback(
      env,
      telegram,
      chatId,
      messageId,
      userId,
      data,
      role
    );
  }

  if (data === "admin:discounts") {
    await ack();

    return adminDiscounts.showDiscounts(
      env,
      telegram,
      chatId,
      messageId,
      role
    );
  }

  if (data.startsWith("admin:discount:")) {
    await ack();

    return adminDiscounts.handleCallback(
      env,
      telegram,
      chatId,
      messageId,
      userId,
      data,
      role
    );
  }

  if (data === "admin:payments") {
    await ack();

    return adminPayments.showPayments(
      env,
      telegram,
      chatId,
      messageId,
      role
    );
  }

  if (data.startsWith("admin:pay:")) {
    await ack();

    const p = data.split(":");

    if (p[2] === "approve") {
      return adminPayments.approvePayment(
        env,
        telegram,
        chatId,
        messageId,
        parseInt(p[3], 10)
      );
    }

    if (p[2] === "reject") {
      return adminPayments.rejectPayment(
        env,
        telegram,
        chatId,
        messageId,
        parseInt(p[3], 10)
      );
    }
  }

  if (data === "admin:broadcast") {
    await ack();

    return adminBroadcast.showBroadcastMenu(
      env,
      telegram,
      chatId,
      messageId,
      role
    );
  }

  if (data.startsWith("admin:broadcast:")) {
    await ack();

    return adminBroadcast.handleCallback(
      env,
      telegram,
      chatId,
      messageId,
      userId,
      data,
      role
    );
  }

  if (data === "admin:admins") {
    await ack();

    return adminAdmins.showAdmins(
      env,
      telegram,
      chatId,
      messageId,
      role
    );
  }

  if (data.startsWith("admin:admins:")) {
    await ack();

    return adminAdmins.handleCallback(
      env,
      telegram,
      chatId,
      messageId,
      userId,
      data,
      role
    );
  }

  if (data === "admin:channels") {
    await ack();

    return adminChannels.showChannels(
      env,
      telegram,
      chatId,
      messageId,
      role
    );
  }

  if (data.startsWith("admin:channel:")) {
    await ack();

    return adminChannels.handleCallback(
      env,
      telegram,
      chatId,
      messageId,
      userId,
      data,
      role
    );
  }

  if (data === "admin:settings") {
    await ack();

    return adminSettings.showSettings(
      env,
      telegram,
      chatId,
      messageId,
      role
    );
  }

  if (data.startsWith("admin:settings:")) {
    await ack();

    return adminSettings.handleCallback(
      env,
      telegram,
      chatId,
      messageId,
      userId,
      data,
      role
    );
  }

  if (data === "admin:faq") {
    await ack();

    return adminFaq.showFaq(
      env,
      telegram,
      chatId,
      messageId,
      role
    );
  }

  if (data.startsWith("admin:faq:")) {
    await ack();

    return adminFaq.handleCallback(
      env,
      telegram,
      chatId,
      messageId,
      userId,
      data,
      role
    );
  }

  if (data === "admin:stats") {
    await ack();

    return adminStats.showStats(
      env,
      telegram,
      chatId,
      messageId,
      role
    );
  }

  if (data === "admin:tickets") {
    await ack();

    return adminTickets.showTickets(
      env,
      telegram,
      chatId,
      messageId,
      role
    );
  }

  if (data.startsWith("admin:ticket:")) {
    const p = data.split(":");

    if (p[2] === "reply") {
      await ack();

      return adminTickets.promptTicketReply(
        env,
        telegram,
        chatId,
        messageId,
        userId,
        parseInt(p[3], 10)
      );
    }

    if (p[2] === "close") {
      await ack();

      return adminTickets.closeTicket(
        env,
        telegram,
        chatId,
        messageId,
        userId,
        parseInt(p[3], 10)
      );
    }
  }

  if (data === "admin:wallet") {
    await ack();

    return showWalletAdminMenu(
      env,
      telegram,
      chatId,
      messageId,
      role
    );
  }

  if (data === "admin:manualsale") {
    await ack();

    return adminManualSale.show(
      env,
      telegram,
      chatId,
      messageId,
      role
    );
  }

  if (data.startsWith("admin:manualsale:")) {
    await ack();

    return adminManualSale.handleCallback(
      env,
      telegram,
      chatId,
      messageId,
      userId,
      data,
      role
    );
  }

  await ack();
}

async function handleAdminTextFallback(
  env,
  telegram,
  message,
  state,
  role
) {
  const chatId = message.chat.id;
  const userId = message.from.id;
  const text = message.text || "";

  if (!text) return false;

  if (state?.step === "admin_search_user") {
    await adminUsers.handleSearchInput(
      env,
      telegram,
      message
    );
    return true;
  }

  if (state?.step === "admin_add_admin_id") {
    await adminAdmins.handleAdminIdInput(
      env,
      telegram,
      message
    );
    return true;
  }

  if (state?.step === "admin_manual_sale_user") {
    await adminManualSale.handleUser(
      env,
      telegram,
      message
    );
    return true;
  }

  return false;
  }
