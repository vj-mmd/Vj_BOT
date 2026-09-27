import { keyboard } from "../lib/keyboards.js";
import { getChannels, getTexts, getAdminRole, getUser, getSettings } from "../lib/kv.js";

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
  buttons.push({ text: "✅ بررسی عضویت", data: "join:check", style: "success" });
  return keyboard(buttons, { perRow: 1 });
}

export async function sendJoinPrompt(env, telegram, chatId, missing) {
  const texts = await getTexts(env.BOT_KV);
  await telegram.sendMessage(chatId, texts.join_required, { reply_markup: joinKeyboard(missing) });
}

// ---- rules acceptance ("glass"/inline button) ----

export function rulesKeyboard() {
  return { inline_keyboard: [[{ text: "✅ می‌پذیرم", callback_data: "rules:accept", style: "success" }]] };
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

export async function mainMenuKeyboard(env) {
  const settings = await getSettings(env.BOT_KV);
  const s = settings.button_styles || {};
  return keyboard(
    [
      { text: "🦠 اکانت تست", data: "test:main", style: s["menu:test"] },
      { text: "💥 خرید اشتراک", data: "buy:categories", style: s["menu:buy"] },
      { text: "🗣 دعوت دوستان", data: "invite:main", style: s["menu:invite"] },
      { text: "💸 کیف پول", data: "wallet:main", style: s["menu:wallet"] },
      { text: "🔍 سرویس‌های من", data: "svc:list", style: s["menu:services"] },
      { text: "☎️ پشتیبانی", data: "support:main", style: s["menu:support"] },
    ],
    { perRow: 2 }
  );
}

export async function sendMainMenu(env, telegram, chatId, messageId) {
  const texts = await getTexts(env.BOT_KV);
  const kb = await mainMenuKeyboard(env);
  await telegram.editOrSend(chatId, messageId, texts.welcome, { reply_markup: kb });
}

export async function isAdmin(env, userId) {
  const role = await getAdminRole(env.BOT_KV, userId);
  return role;
}
