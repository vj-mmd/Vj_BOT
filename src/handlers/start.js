import { getOrCreateUser, getUser, saveUser, getTexts } from "../lib/kv.js";
import { checkJoined, sendJoinPrompt, sendMainMenu, proceedAfterJoin } from "./menu.js";

export async function handleStart(env, telegram, message) {
  const chatId = message.chat.id;
  const from = message.from;
  const text = message.text || "";

  let referredBy = null;
  const parts = text.split(" ");
  if (parts[1] && parts[1].startsWith("ref")) {
    const refId = parseInt(parts[1].replace("ref", ""), 10);
    if (!Number.isNaN(refId) && refId !== from.id) referredBy = refId;
  }

  const { user } = await getOrCreateUser(env.BOT_KV, from, referredBy);

  if (user.banned) {
    await telegram.sendMessage(chatId, "⛔ دسترسی شما به ربات مسدود شده است.");
    return;
  }

  const joinStatus = await checkJoined(env, telegram, from.id);
  if (!joinStatus.ok) {
    await sendJoinPrompt(env, telegram, chatId, joinStatus.missing);
    return;
  }

  await proceedAfterJoin(env, telegram, chatId, from.id);
}

export async function handleJoinCheck(env, telegram, callbackQuery) {
  const chatId = callbackQuery.message.chat.id;
  const messageId = callbackQuery.message.message_id;
  const userId = callbackQuery.from.id;

  const joinStatus = await checkJoined(env, telegram, userId);
  if (!joinStatus.ok) {
    await telegram.answerCallbackQuery(callbackQuery.id, "❌ هنوز در همه کانال‌ها عضو نشده‌اید.", true);
    return;
  }

  await telegram.deleteMessage(chatId, messageId);
  await telegram.answerCallbackQuery(callbackQuery.id, "✅ عضویت تأیید شد");
  await proceedAfterJoin(env, telegram, chatId, userId);
}

// User tapped the "✅ می‌پذیرم" glass button under the rules message.
export async function handleRulesAccept(env, telegram, callbackQuery) {
  const chatId = callbackQuery.message.chat.id;
  const messageId = callbackQuery.message.message_id;
  const userId = callbackQuery.from.id;

  const user = await getUser(env.BOT_KV, userId);
  if (!user) return;

  user.rules_accepted = true;
  await saveUser(env.BOT_KV, user);

  await telegram.deleteMessage(chatId, messageId);
  await telegram.answerCallbackQuery(callbackQuery.id, "✅ قوانین پذیرفته شد");
  await proceedAfterJoin(env, telegram, chatId, userId);
}

// User shared their phone number via the contact-request keyboard button.
export async function handleContact(env, telegram, message) {
  const chatId = message.chat.id;
  const userId = message.from.id;
  const contact = message.contact;

  if (!contact || contact.user_id !== userId) {
    await telegram.sendMessage(chatId, "❌ لطفاً شماره تلفن خودِ خودتان را با همان دکمه ارسال کنید.");
    return;
  }

  const user = await getUser(env.BOT_KV, userId);
  if (!user) return;

  user.phone = contact.phone_number;
  user.phone_verified = true;
  await saveUser(env.BOT_KV, user);

  const texts = await getTexts(env.BOT_KV);
  // Drop the reply keyboard, then clean up the two messages involved so the
  // chat ends up on a clean main menu with nothing left over.
  const confirm = await telegram.sendMessage(chatId, texts.phone_verified, { reply_markup: { remove_keyboard: true } });
  try { await telegram.deleteMessage(chatId, message.message_id); } catch {}
  if (confirm.ok) { try { await telegram.deleteMessage(chatId, confirm.result.message_id); } catch {} }

  await sendMainMenu(env, telegram, chatId, null);
}
