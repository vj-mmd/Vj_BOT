import { keyboard } from "../lib/keyboards.js";
import { getChannels, getTexts, getAdminRole } from "../lib/kv.js";

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

export async function mainMenuKeyboard() {
  return keyboard(
    [
      { text: "🦠 اکانت تست", data: "test:main" },
      { text: "💥 خرید اشتراک", data: "buy:categories" },
      { text: "🗣 دعوت دوستان", data: "invite:main" },
      { text: "💸 کیف پول", data: "wallet:main" },
      { text: "🔍 سرویس‌های من", data: "svc:list" },
      { text: "☎️ پشتیبانی", data: "support:main" },
    ],
    { perRow: 2 }
  );
}

export async function sendMainMenu(env, telegram, chatId, messageId) {
  const texts = await getTexts(env.BOT_KV);
  const kb = await mainMenuKeyboard();
  await telegram.editOrSend(chatId, messageId, texts.welcome, { reply_markup: kb });
}

export async function isAdmin(env, userId) {
  const role = await getAdminRole(env.BOT_KV, userId);
  return role;
}
