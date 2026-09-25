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
  await clearState(env, adminId);

  const ids = await targetUserIds(env.BOT_KV, state.target);
  await telegram.sendMessage(chatId, `⏳ در حال ارسال به ${ids.length} کاربر...`);

  let sent = 0;
  let failed = 0;
  for (const id of ids) {
    try {
      if (message.photo) {
        const photo = message.photo[message.photo.length - 1];
        await telegram.sendPhoto(id, photo.file_id, { caption: message.caption || "" });
      } else {
        await telegram.sendMessage(id, message.text || "");
      }
      sent++;
    } catch {
      failed++;
    }
  }

  await logAction(env.BOT_KV, adminId, "broadcast", { target: state.target, sent, failed });
  await telegram.sendMessage(chatId, `📊 ارسال کامل شد.\n✅ موفق: ${sent}\n❌ ناموفق: ${failed}`, {
    reply_markup: keyboard([], { back: "admin:main" }),
  });
}
