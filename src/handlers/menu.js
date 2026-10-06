import { keyboard } from "../lib/keyboards.js";
import { getChannels, getTexts, getAdminRole, getUser, getUserServices, getSettings } from "../lib/kv.js";

export async function checkJoined(env, telegram, userId) {
  const channels = await getChannels(env.BOT_KV);
  const active = channels.filter((c) => c.active);
  if (active.length === 0) return { ok: true, missing: [] };

  const missing = [];
  for (const ch of active) {
    const res = await telegram.getChatMember(ch.chat_id, userId);
    const status = res.ok ? res.result.status : "left";
    if (!["member", "administrator", "creator"].includes(status)) {
      missing.push(ch);
    }
  }
  return { ok: missing.length === 0, missing };
}

export function joinKeyboard(missing) {
  const buttons = missing.map((c) => ({ text: `📢 عضویت در ${c.name}`, url: c.invite_url }));
  buttons.push({ text: "✅ بررسی عضویت", data: "join:check" });
  return keyboard(buttons, { perRow: 1 });
}

export async function sendJoinPrompt(env, telegram, chatId, missing) {
  const texts = await getTexts(env.BOT_KV);
  await telegram.sendMessage(chatId, texts.join_required, { reply_markup: joinKeyboard(missing) });
}

// ---- rules acceptance ("glass"/inline button) ----

export function rulesKeyboard() {
  return keyboard([{ text: "✅ می‌پذیرم", data: "rules:accept" }], { perRow: 1 });
}

export async function sendRulesPrompt(env, telegram, chatId) {
  const texts = await getTexts(env.BOT_KV);
  await telegram.sendMessage(chatId, texts.rules, { reply_markup: rulesKeyboard() });
}

// ---- phone verification (Telegram contact-share button) ----

export function phoneRequestKeyboard() {
  return {
    keyboard: [[{ text: "📱 ارسال شماره تلفن", request_contact: true }]],
    resize_keyboard: true,
    one_time_keyboard: true,
  };
}

export async function sendPhonePrompt(env, telegram, chatId) {
  const texts = await getTexts(env.BOT_KV);
  await telegram.sendMessage(chatId, texts.phone_request, { reply_markup: phoneRequestKeyboard() });
}

// Runs once the forced-join gate has passed: rules -> phone -> main menu.
// Each step only shows if the user hasn't completed it yet, so returning
// users who already accepted/verified skip straight to the menu.
export async function proceedAfterJoin(env, telegram, chatId, userId) {
  const user = await getUser(env.BOT_KV, userId);
  if (!user) return;
  if (!user.rules_accepted) return sendRulesPrompt(env, telegram, chatId);
  if (!user.phone_verified) return sendPhonePrompt(env, telegram, chatId);
  return sendMainMenu(env, telegram, chatId, null);
}

export async function mainMenuKeyboard(settings) {
  const f = settings.features || {};
  const texts = settings.__texts || {};
  const buttons = [];
  if (f.buy !== false) buttons.push({ text: texts.menu_buy || "💥 خرید اشتراک", data: "buy:categories" });
  if (f.wallet !== false) buttons.push({ text: texts.menu_wallet || "💸 کیف پول", data: "wallet:main" });
  if (f.services !== false) buttons.push({ text: texts.menu_services || "🔍 سرویس‌های من", data: "svc:list" });
  if (f.test !== false) buttons.push({ text: texts.menu_test || "🦠 اکانت تست", data: "test:main" });
  if (f.referral !== false) buttons.push({ text: texts.menu_referral || "🗣 دعوت دوستان", data: "invite:main" });
  if (f.support !== false) buttons.push({ text: texts.menu_support || "☎️ پشتیبانی آنلاین", data: "support:main" });
  if (f.faq !== false) buttons.push({ text: texts.menu_faq || "❓ راهنما و سوالات متداول", data: "support:faq" });
  return keyboard(buttons, { perRow: 2 });
}

export async function sendMainMenu(env, telegram, chatId, messageId) {
  const texts = await getTexts(env.BOT_KV);
  const userId = chatId;
  const user = await getUser(env.BOT_KV, userId);
  const name = String(user?.first_name || "کاربر").replace(/[<>]/g, "").slice(0, 40);
  const header =
    `سلام <b>${name}</b> عزیز\n\n` +
    `بخش مورد نظر خود را انتخاب کنید:`;
  await telegram.editOrSend(chatId, messageId, header || texts.welcome, { reply_markup: await mainMenuKeyboard({ ...(await getSettings(env.BOT_KV)), __texts: await getTexts(env.BOT_KV) }) });
}

export async function isAdmin(env, userId) {
  const role = await getAdminRole(env.BOT_KV, userId);
  return role;
}
