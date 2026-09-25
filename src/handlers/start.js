import { getOrCreateUser, getUser } from "../lib/kv.js";
import { checkJoined, sendJoinPrompt, sendMainMenu } from "./menu.js";

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

  await sendMainMenu(env, telegram, chatId, null);
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
  await sendMainMenu(env, telegram, chatId, null);
}
