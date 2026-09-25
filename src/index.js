import { tg } from "./lib/telegram.js";
import { getState, clearState } from "./lib/state.js";
import { getUser, getActiveServiceIndex, getService, saveService, getPanel } from "./lib/kv.js";
import { adapterFor } from "./lib/panels/index.js";

import { handleStart, handleJoinCheck } from "./handlers/start.js";
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
import * as adminStats from "./handlers/admin/stats.js";
import * as adminTickets from "./handlers/admin/tickets.js";
import { showWalletAdminMenu } from "./handlers/admin/walletAdmin.js";

export default {
  async fetch(request, env, ctx) {
    if (request.method !== "POST") {
      return new Response("VPN Shop Bot is running.", { status: 200 });
    }

    // Verify the request actually came from Telegram.
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
      if (update.message) {
        await onMessage(env, telegram, update.message);
      } else if (update.callback_query) {
        await onCallback(env, telegram, update.callback_query);
      }
    } catch (err) {
      console.log("UNHANDLED ERROR", err && err.stack ? err.stack : err);
    }

    // Telegram just needs a 200 - errors above are logged, not surfaced to it.
    return new Response("ok", { status: 200 });
  },

  // Optional: enable a Cron Trigger (see wrangler.toml) to sweep expired
  // services periodically. Safe to leave disabled if you'd rather check
  // expiry lazily (e.g. only when a user opens "My services").
  async scheduled(event, env, ctx) {
    const telegram = tg(env);
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
          if (adapter.disableUser) await adapter.disableUser(panel, service.username);
        } catch (e) {
          console.log("disable expired service failed", service.id, e);
        }
      }
      await telegram.sendMessage(service.user_id, `🔴 سرویس #${service.id} شما منقضی شد.`);
    } else if (msLeft <= 24 * 3600 * 1000 && !service.warned_24h) {
      service.warned_24h = true;
      await saveService(kv, service);
      await telegram.sendMessage(service.user_id, `⚠️ سرویس #${service.id} شما 24 ساعت دیگر منقضی می‌شود.`);
    }
  }
}

// ---------------- messages (text / photo) ----------------

async function onMessage(env, telegram, message) {
  const chatId = message.chat.id;
  const userId = message.from.id;
  const text = message.text || "";

  if (text.startsWith("/start")) return handleStart(env, telegram, message);

  if (text.startsWith("/admin")) {
    const role = await requireAdmin(env, userId);
    if (!role) return; // silently ignore for non-admins
    return showAdminMenu(env, telegram, chatId, null, role);
  }

  const adminRole = await requireAdmin(env, userId);

  const user = await getUser(env.BOT_KV, userId);
  if (user && user.banned && !adminRole) return;

  // Forced-join gate applies to regular users; admins mid-flow (e.g. typing a
  // search query) shouldn't get stuck behind it.
  if (user && !adminRole) {
    const joinStatus = await checkJoined(env, telegram, userId);
    if (!joinStatus.ok) return sendJoinPrompt(env, telegram, chatId, joinStatus.missing);
  }

  const state = await getState(env, userId);
  if (!state) return; // no pending step -> nothing to do with a stray message

  switch (state.step) {
    case "await_discount_code":
      return purchase.handleDiscountCodeInput(env, telegram, message, state);
    case "await_custom_amount":
      return wallet.handleCustomAmountInput(env, telegram, message);
    case "await_receipt_photo":
      if (!message.photo) return telegram.sendMessage(chatId, "📸 لطفاً یک تصویر ارسال کنید.");
      return wallet.handleReceiptPhoto(env, telegram, message, state);
    case "await_ticket_message":
      return support.handleTicketMessageInput(env, telegram, message, state);

    // ---- admin text-input steps ----
    case "admin_search_user":
      return adminUsers.handleSearchInput(env, telegram, message);
    case "admin_balance_amount":
      return adminUsers.handleBalanceAmountInput(env, telegram, message, state);
    case "admin_add_category":
    case "admin_rename_category":
      return adminCategories.handleCategoryTextInput(env, telegram, message, state);
    case "admin_add_product_name":
    case "admin_add_product_price":
    case "admin_add_product_volume":
    case "admin_add_product_days":
    case "admin_add_product_protocol":
    case "admin_add_product_desc":
      return adminProducts.handleProductTextInput(env, telegram, message, state);
    case "admin_add_panel_name":
    case "admin_add_panel_url":
    case "admin_add_panel_user":
    case "admin_add_panel_pass":
      return adminPanels.handlePanelTextInput(env, telegram, message, state);
    case "admin_add_profile_name":
      return adminProfiles.handleProfileTextInput(env, telegram, message, state);
    case "admin_add_disc_code":
    case "admin_add_disc_value":
    case "admin_add_disc_maxuses":
    case "admin_add_disc_days":
      return adminDiscounts.handleDiscountTextInput(env, telegram, message, state);
    case "admin_broadcast_message":
      return adminBroadcast.handleBroadcastContent(env, telegram, message, state);
    case "admin_add_admin_id":
      return adminAdmins.handleAdminIdInput(env, telegram, message);
    case "admin_add_chan_name":
    case "admin_add_chan_id":
    case "admin_add_chan_url":
      return adminChannels.handleChannelTextInput(env, telegram, message, state);
    case "admin_set_field":
      return adminSettings.handleSettingValueInput(env, telegram, message, state);
    case "admin_set_text":
      return adminSettings.handleTextValueInput(env, telegram, message, state);
    case "admin_ticket_reply":
      return adminTickets.handleTicketReplyInput(env, telegram, message, state);
    default:
      return;
  }
}

// ---------------- callback_query (button taps) ----------------

async function onCallback(env, telegram, cq) {
  const chatId = cq.message.chat.id;
  const messageId = cq.message.message_id;
  const userId = cq.from.id;
  const data = cq.data || "";
  const p = data.split(":");

  // Always ack quickly so Telegram stops showing the loading spinner;
  // individual handlers can send a richer answerCallbackQuery themselves
  // (e.g. with an alert) when they need to.
  const ack = () => telegram.answerCallbackQuery(cq.id, "");

  if (data === "join:check") return handleJoinCheck(env, telegram, cq);

  // Forced-join gate for every other button.
  const joinStatus = await checkJoined(env, telegram, userId);
  if (!joinStatus.ok) {
    await telegram.answerCallbackQuery(cq.id, "ابتدا در کانال‌ها عضو شوید.", true);
    return sendJoinPrompt(env, telegram, chatId, joinStatus.missing);
  }

  // ---- user-facing menu ----
  if (data === "menu:main") { await ack(); return sendMainMenu(env, telegram, chatId, messageId); }

  if (data === "test:main") { await ack(); return showTestMenu(env, telegram, chatId, messageId); }
  if (data === "test:get") { await ack(); return handleTestGet(env, telegram, chatId, messageId, userId); }

  if (data === "buy:categories") { await ack(); return purchase.showCategories(env, telegram, chatId, messageId); }
  if (p[0] === "buy" && p[1] === "cat") { await ack(); return purchase.showProducts(env, telegram, chatId, messageId, parseInt(p[2], 10)); }
  if (p[0] === "buy" && p[1] === "prod") { await ack(); return purchase.showProductDetail(env, telegram, chatId, messageId, parseInt(p[2], 10)); }
  if (p[0] === "buy" && p[1] === "discount") { await ack(); return purchase.promptDiscountCode(env, telegram, chatId, messageId, userId, parseInt(p[2], 10)); }
  if (p[0] === "buy" && p[1] === "pay") { await ack(); return purchase.showPayConfirm(env, telegram, chatId, messageId, userId, parseInt(p[2], 10), p[3]); }
  if (p[0] === "buy" && p[1] === "confirm") { await ack(); return purchase.handlePurchaseConfirm(env, telegram, chatId, messageId, userId, parseInt(p[2], 10), p[3], cq.id); }

  if (data === "wallet:main") { await ack(); return wallet.showWallet(env, telegram, chatId, messageId, userId); }
  if (data === "wallet:charge") { await ack(); return wallet.showChargeOptions(env, telegram, chatId, messageId); }
  if (data === "wallet:charge:card") { await ack(); return wallet.showCardToCard(env, telegram, chatId, messageId); }
  if (data === "wallet:charge:gateway") { await ack(); return wallet.showGatewayNotice(env, telegram, chatId, messageId); }
  if (p[0] === "wallet" && p[1] === "amt") { await ack(); return wallet.handleAmountChosen(env, telegram, chatId, messageId, userId, p[2]); }
  if (data === "wallet:tx") { await ack(); return wallet.showTransactions(env, telegram, chatId, messageId, userId); }

  if (data === "invite:main") { await ack(); return showReferral(env, telegram, chatId, messageId, userId); }
  if (data === "invite:stats") { await ack(); return showReferral(env, telegram, chatId, messageId, userId); }

  if (data === "svc:list") { await ack(); return services.showServiceList(env, telegram, chatId, messageId, userId); }
  if (p[0] === "svc" && p[1] === "view") { await ack(); return services.showServiceDetail(env, telegram, chatId, messageId, parseInt(p[2], 10)); }
  if (p[0] === "svc" && p[1] === "refresh") { await ack(); return services.refreshService(env, telegram, chatId, messageId, parseInt(p[2], 10)); }

  if (data === "support:main") { await ack(); return support.showSupportMenu(env, telegram, chatId, messageId); }
  if (data === "support:faq") { await ack(); return support.showFaqList(env, telegram, chatId, messageId); }
  if (p[0] === "support" && p[1] === "faq" && p[2] !== undefined) { await ack(); return support.showFaqAnswer(env, telegram, chatId, messageId, parseInt(p[2], 10)); }
  if (data === "support:ticket") { await ack(); return support.startTicketFlow(env, telegram, chatId, messageId, userId); }

  // ---- admin ----
  if (data.startsWith("admin")) return onAdminCallback(env, telegram, cq, p, ack);
}

async function onAdminCallback(env, telegram, cq, p, ack) {
  const chatId = cq.message.chat.id;
  const messageId = cq.message.message_id;
  const adminId = cq.from.id;
  const data = cq.data;

  const role = await requireAdmin(env, adminId);
  if (!role) { await telegram.answerCallbackQuery(cq.id, "دسترسی ندارید.", true); return; }
  const isOwner = role === "owner";

  if (data === "admin:main") { await ack(); return showAdminMenu(env, telegram, chatId, messageId, role); }

  // users
  if (data === "admin:users") { await ack(); return adminUsers.showUsersMenu(env, telegram, chatId, messageId); }
  if (data === "admin:users:search") { await ack(); return adminUsers.promptSearch(env, telegram, chatId, messageId, adminId); }
  if (p[1] === "user" && p[2] === "card") { await ack(); return adminUsers.sendUserCard(env, telegram, chatId, messageId, parseInt(p[3], 10)); }
  if (p[1] === "user" && p[2] === "ban") { await ack(); return adminUsers.toggleBan(env, telegram, chatId, messageId, adminId, parseInt(p[3], 10), true); }
  if (p[1] === "user" && p[2] === "unban") { await ack(); return adminUsers.toggleBan(env, telegram, chatId, messageId, adminId, parseInt(p[3], 10), false); }
  if (p[1] === "user" && p[2] === "resettest") { await ack(); return adminUsers.resetTest(env, telegram, chatId, messageId, adminId, parseInt(p[3], 10)); }
  if (p[1] === "user" && p[2] === "credit") { await ack(); return adminUsers.promptBalanceAmount(env, telegram, chatId, messageId, adminId, parseInt(p[3], 10), "credit"); }
  if (p[1] === "user" && p[2] === "debit") { await ack(); return adminUsers.promptBalanceAmount(env, telegram, chatId, messageId, adminId, parseInt(p[3], 10), "debit"); }
  if (p[1] === "user" && p[2] === "services") { await ack(); return adminUsers.showUserServices(env, telegram, chatId, messageId, parseInt(p[3], 10)); }
  if (p[1] === "user" && p[2] === "orders") { await ack(); return adminUsers.showUserOrders(env, telegram, chatId, messageId, parseInt(p[3], 10)); }

  // products
  if (data === "admin:products") { await ack(); return adminProducts.showProductsAdmin(env, telegram, chatId, messageId); }
  if (data === "admin:prod:add") { await ack(); return adminProducts.startAddProduct(env, telegram, chatId, messageId, adminId); }
  if (p[1] === "prod" && p[2] === "add" && p[3] === "cat") { await ack(); return adminProducts.addProductPickCategory(env, telegram, chatId, messageId, adminId, parseInt(p[4], 10)); }
  if (p[1] === "prod" && p[2] === "add" && p[3] === "panel") {
    await ack();
    const state = await getState(env, adminId);
    return adminProducts.addProductPickPanel(env, telegram, chatId, messageId, adminId, parseInt(p[4], 10), state ? state.data : {});
  }
  if (p[1] === "prod" && p[2] === "add" && p[3] === "profile") {
    await ack();
    const state = await getState(env, adminId);
    return adminProducts.addProductPickProfile(env, telegram, chatId, messageId, adminId, parseInt(p[4], 10), state ? state.data : {});
  }
  if (p[1] === "prod" && p[2] === "view") { await ack(); return adminProducts.showProductDetailAdmin(env, telegram, chatId, messageId, parseInt(p[3], 10)); }
  if (p[1] === "prod" && p[2] === "toggle") { await ack(); return adminProducts.toggleProduct(env, telegram, chatId, messageId, adminId, parseInt(p[3], 10)); }
  if (p[1] === "prod" && p[2] === "delete") { await ack(); return adminProducts.removeProduct(env, telegram, chatId, messageId, adminId, parseInt(p[3], 10)); }

  // categories
  if (data === "admin:categories") { await ack(); return adminCategories.showCategoriesAdmin(env, telegram, chatId, messageId); }
  if (data === "admin:cat:add") { await ack(); return adminCategories.promptAddCategory(env, telegram, chatId, messageId, adminId); }
  if (p[1] === "cat" && p[2] === "view") { await ack(); return adminCategories.showCategoryDetail(env, telegram, chatId, messageId, parseInt(p[3], 10)); }
  if (p[1] === "cat" && p[2] === "rename") { await ack(); return adminCategories.promptRenameCategory(env, telegram, chatId, messageId, adminId, parseInt(p[3], 10)); }
  if (p[1] === "cat" && p[2] === "toggle") { await ack(); return adminCategories.toggleCategory(env, telegram, chatId, messageId, adminId, parseInt(p[3], 10)); }
  if (p[1] === "cat" && p[2] === "delete") { await ack(); return adminCategories.deleteCategory(env, telegram, chatId, messageId, adminId, parseInt(p[3], 10)); }

  // panels
  if (data === "admin:panels") { await ack(); return adminPanels.showPanelsAdmin(env, telegram, chatId, messageId); }
  if (data === "admin:panel:add") { await ack(); return adminPanels.startAddPanel(env, telegram, chatId, messageId, adminId); }
  if (p[1] === "panel" && p[2] === "add" && p[3] === "type") { await ack(); return adminPanels.addPanelPickType(env, telegram, chatId, messageId, adminId, p[4]); }
  if (p[1] === "panel" && p[2] === "view") { await ack(); return adminPanels.showPanelDetail(env, telegram, chatId, messageId, parseInt(p[3], 10)); }
  if (p[1] === "panel" && p[2] === "toggle") { await ack(); return adminPanels.togglePanel(env, telegram, chatId, messageId, adminId, parseInt(p[3], 10)); }
  if (p[1] === "panel" && p[2] === "delete") { await ack(); return adminPanels.removePanel(env, telegram, chatId, messageId, adminId, parseInt(p[3], 10)); }
  if (p[1] === "panel" && p[2] === "test") { return adminPanels.runPanelTest(env, telegram, chatId, parseInt(p[3], 10), cq.id); }

  // profiles
  if (data === "admin:profiles") { await ack(); return adminProfiles.showProfilesMenu(env, telegram, chatId, messageId); }
  if (p[1] === "profiles" && p[2] === "panel") { await ack(); return adminProfiles.showPanelProfiles(env, telegram, chatId, messageId, parseInt(p[3], 10)); }
  if (p[1] === "profile" && p[2] === "add" && p[3] === "proto") { await ack(); return adminProfiles.addProfilePickProtocol(env, telegram, chatId, messageId, adminId, parseInt(p[4], 10), p[5]); }
  if (p[1] === "profile" && p[2] === "add") { await ack(); return adminProfiles.startAddProfile(env, telegram, chatId, messageId, adminId, parseInt(p[3], 10)); }
  if (p[1] === "profile" && p[2] === "view") { await ack(); return adminProfiles.showProfileDetail(env, telegram, chatId, messageId, parseInt(p[3], 10), parseInt(p[4], 10)); }
  if (p[1] === "profile" && p[2] === "toggle") { await ack(); return adminProfiles.toggleProfile(env, telegram, chatId, messageId, adminId, parseInt(p[3], 10), parseInt(p[4], 10)); }
  if (p[1] === "profile" && p[2] === "delete") { await ack(); return adminProfiles.deleteProfile(env, telegram, chatId, messageId, adminId, parseInt(p[3], 10), parseInt(p[4], 10)); }

  // discounts
  if (data === "admin:discounts") { await ack(); return adminDiscounts.showDiscountsAdmin(env, telegram, chatId, messageId); }
  if (data === "admin:disc:add") { await ack(); return adminDiscounts.startAddDiscount(env, telegram, chatId, messageId, adminId); }
  if (p[1] === "disc" && p[2] === "add" && p[3] === "type") {
    await ack();
    const state = await getState(env, adminId);
    return adminDiscounts.pickDiscountTypeDone(env, telegram, chatId, messageId, adminId, p[4], state ? state.data.code : null);
  }
  if (p[1] === "disc" && p[2] === "view") { await ack(); return adminDiscounts.showDiscountDetail(env, telegram, chatId, messageId, p[3]); }
  if (p[1] === "disc" && p[2] === "toggle") { await ack(); return adminDiscounts.toggleDiscount(env, telegram, chatId, messageId, adminId, p[3]); }
  if (p[1] === "disc" && p[2] === "delete") { await ack(); return adminDiscounts.removeDiscount(env, telegram, chatId, messageId, adminId, p[3]); }
  if (p[1] === "disc" && p[2] === "stats") { await ack(); return adminDiscounts.showDiscountDetail(env, telegram, chatId, messageId, p[3]); }

  // payments
  if (data === "admin:payments") { await ack(); return adminPayments.showPaymentsAdmin(env, telegram, chatId, messageId); }
  if (p[1] === "pay" && p[2] === "view") { await ack(); return adminPayments.showPaymentDetail(env, telegram, chatId, messageId, parseInt(p[3], 10)); }
  if (p[1] === "pay" && p[2] === "approve") { await ack(); return adminPayments.approvePayment(env, telegram, chatId, adminId, parseInt(p[3], 10)); }
  if (p[1] === "pay" && p[2] === "reject") { await ack(); return adminPayments.rejectPayment(env, telegram, chatId, adminId, parseInt(p[3], 10)); }

  // wallet (admin entry point)
  if (data === "admin:wallet") { await ack(); return showWalletAdminMenu(env, telegram, chatId, messageId); }

  // broadcast
  if (data === "admin:broadcast") { await ack(); return adminBroadcast.showBroadcastMenu(env, telegram, chatId, messageId); }
  if (p[1] === "bc" && p[2] === "target") { await ack(); return adminBroadcast.pickBroadcastTarget(env, telegram, chatId, messageId, adminId, p[3]); }

  // admins (owner only)
  if (data === "admin:admins") { if (!isOwner) { await telegram.answerCallbackQuery(cq.id, "فقط Owner", true); return; } await ack(); return adminAdmins.showAdminsList(env, telegram, chatId, messageId); }
  if (data === "admin:admin:add") { await ack(); return adminAdmins.promptAddAdmin(env, telegram, chatId, messageId, adminId); }
  if (p[1] === "admin" && p[2] === "add" && p[3] === "role") {
    await ack();
    const state = await getState(env, adminId);
    return adminAdmins.finishAddAdmin(env, telegram, chatId, messageId, adminId, p[4], state ? state.target_id : null);
  }
  if (p[1] === "admin" && p[2] === "view") { await ack(); return adminAdmins.showAdminDetail(env, telegram, chatId, messageId, parseInt(p[3], 10)); }
  if (p[1] === "admin" && p[2] === "remove") { return adminAdmins.removeAdmin(env, telegram, chatId, messageId, adminId, parseInt(p[3], 10), cq.id); }

  // channels
  if (data === "admin:channels") { await ack(); return adminChannels.showChannelsAdmin(env, telegram, chatId, messageId); }
  if (data === "admin:chan:add") { await ack(); return adminChannels.startAddChannel(env, telegram, chatId, messageId, adminId); }
  if (p[1] === "chan" && p[2] === "view") { await ack(); return adminChannels.showChannelDetail(env, telegram, chatId, messageId, parseInt(p[3], 10)); }
  if (p[1] === "chan" && p[2] === "toggle") { await ack(); return adminChannels.toggleChannel(env, telegram, chatId, messageId, adminId, parseInt(p[3], 10)); }
  if (p[1] === "chan" && p[2] === "delete") { await ack(); return adminChannels.removeChannel(env, telegram, chatId, messageId, adminId, parseInt(p[3], 10)); }

  // settings
  if (data === "admin:settings") { await ack(); return adminSettings.showSettingsMenu(env, telegram, chatId, messageId); }
  if (p[1] === "set" && p[2] === "field") { await ack(); return adminSettings.promptSettingValue(env, telegram, chatId, messageId, adminId, p[3]); }
  if (data === "admin:set:gateway") { await ack(); return adminSettings.toggleGateway(env, telegram, chatId, messageId, adminId); }
  if (data === "admin:set:texts") { await ack(); return adminSettings.showTextsMenu(env, telegram, chatId, messageId); }
  if (p[1] === "text" && p[2] === "field") { await ack(); return adminSettings.promptTextValue(env, telegram, chatId, messageId, adminId, p[3]); }

  // stats / audit
  if (data === "admin:stats") { await ack(); return adminStats.showStats(env, telegram, chatId, messageId); }
  if (data === "admin:audit") { await ack(); return adminStats.showAudit(env, telegram, chatId, messageId); }

  // tickets
  if (data === "admin:tickets") { await ack(); return adminTickets.showOpenTickets(env, telegram, chatId, messageId); }
  if (p[1] === "ticket" && p[2] === "view") { await ack(); return adminTickets.showTicketDetail(env, telegram, chatId, messageId, parseInt(p[3], 10)); }
  if (p[1] === "ticket" && p[2] === "reply") { await ack(); return adminTickets.promptTicketReply(env, telegram, chatId, messageId, adminId, parseInt(p[3], 10)); }
  if (p[1] === "ticket" && p[2] === "close") { await ack(); return adminTickets.closeTicket(env, telegram, chatId, messageId, adminId, parseInt(p[3], 10)); }

  await ack();
}
