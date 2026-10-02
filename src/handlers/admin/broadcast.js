import { keyboard } from "../../lib/keyboards.js";
import { setState, clearState } from "../../lib/state.js";
import { getIndex, getUser, getUserServices, logAction } from "../../lib/kv.js";

export async function showBroadcastMenu(env, telegram, chatId, messageId) {
  const buttons = [
    { text: "📢 همه کاربران", data: "admin:bc:target:all" },
    { text: "📦 کاربران دارای سرویس", data: "admin:bc:target:with_service" },
    { text: "🚫 کاربران بدون سرویس", data: "admin:bc:target:without_service" },
  ];
  await telegram.editOrSend(chatId, messageId, "📢 ارسال پیام همگانی به چه کسانی؟", {
    reply_markup: keyboard(buttons, { perRow: 1, back: "admin:main" }),
  });
}

export async function pickBroadcastTarget(env, telegram, chatId, messageId, adminId, target) {
  await setState(env, adminId, { step: "admin_broadcast_message", target });
  await telegram.editOrSend(chatId, messageId, "متن یا تصویر پیام همگانی را ارسال کنید:", {
    reply_markup: keyboard([], { back: "admin:broadcast" }),
  });
}

async function targetUserIds(kv, target) {
  const allIds = await getIndex(kv, "index:users");
  if (target === "all") return allIds;

  const withService = [];
  const withoutService = [];
  for (const id of allIds) {
    const services = await getUserServices(kv, id);
    if (services.filter(Boolean).length > 0) withService.push(id);
    else withoutService.push(id);
  }
  return target === "with_service" ? withService : withoutService;
}

export async function handleBroadcastContent(env, telegram, message, state) {
  const chatId = message.chat.id;
  const adminId = message.from.id;
  const content = message.photo
    ? { type: "photo", file_id: message.photo[message.photo.length - 1].file_id, caption: message.caption || "" }
    : { type: "text", text: message.text || "" };

  await setState(env, adminId, { step: "admin_broadcast_buttons", target: state.target, content });
  await telegram.sendMessage(chatId,
    "🔘 <b>دکمه‌های شیشه‌ای</b>\n\n" +
    "اگر دکمه نمی‌خواهی، <code>none</code> بفرست.\n" +
    "برای چند دکمه، هر خط یکی:\n" +
    "<code>تست | https://example.com</code>\n" +
    "<code>خرید | https://example.com/buy</code>",
    { reply_markup: keyboard([], { back: "admin:broadcast" }) });
}

function parseButtons(text) {
  if ((text || "").trim().toLowerCase() === "none") return [];
  return (text || "").split("\n").map(x => x.split("|")).map(([label, url]) => ({
    text: (label || "").trim(), url: (url || "").trim()
  })).filter(x => x.text && /^https?:\/\//i.test(x.url));
}

export async function handleBroadcastButtons(env, telegram, message, state) {
  const adminId = message.from.id;
  const ids = await targetUserIds(env.BOT_KV, state.target);
  const buttons = parseButtons(message.text || "");
  const markup = buttons.length ? keyboard(buttons, { perRow: 2 }) : undefined;
  await clearState(env, adminId);
  await telegram.sendMessage(message.chat.id, `⏳ در حال ارسال به ${ids.length} کاربر...`);

  let sent = 0, failed = 0;
  for (const id of ids) {
    try {
      if (state.content.type === "photo") {
        await telegram.sendPhoto(id, state.content.file_id, { caption: state.content.caption, ...(markup ? { reply_markup: markup } : {}) });
      } else {
        await telegram.sendMessage(id, state.content.text, ...(markup ? [{ reply_markup: markup }] : [{}])[0]);
      }
      sent++;
    } catch { failed++; }
  }
  await logAction(env.BOT_KV, adminId, "broadcast", { target: state.target, sent, failed, buttons: buttons.length });
  await telegram.sendMessage(message.chat.id, `📊 ارسال کامل شد.\n✅ موفق: ${sent}\n❌ ناموفق: ${failed}`, {
    reply_markup: keyboard([], { back: "admin:main" }),
  });
}