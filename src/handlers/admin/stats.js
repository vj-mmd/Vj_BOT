import { keyboard } from "../../lib/keyboards.js";
import { getStats, getRecentAudit, getActiveServiceIndex, getService } from "../../lib/kv.js";

export async function showStats(env, telegram, chatId, messageId) {
  const stats = await getStats(env.BOT_KV);
  const activeIds = await getActiveServiceIndex(env.BOT_KV);
  const services = await Promise.all(activeIds.map((id) => getService(env.BOT_KV, id)));
  const activeCount = services.filter((s) => s && Date.now() < s.expires_at).length;
  const expiredCount = services.filter((s) => s && Date.now() >= s.expires_at).length;

  const text =
    `📊 <b>آمار کلی</b>\n\n` +
    `👥 کل کاربران: ${stats.total_users}\n` +
    `📦 سرویس‌های فعال: ${activeCount}\n` +
    `🔴 سرویس‌های منقضی: ${expiredCount}\n` +
    `🛒 تعداد سفارش‌ها: ${stats.total_orders}\n` +
    `💰 فروش کل: ${stats.total_sales.toLocaleString("en-US")} تومان\n` +
    `💳 شارژ کیف پول: ${stats.total_charge.toLocaleString("en-US")} تومان\n` +
    `🎁 تست‌های استفاده‌شده: ${stats.tests_used}`;

  await telegram.editOrSend(chatId, messageId, text, { reply_markup: keyboard([], { back: "admin:main" }) });
}

export async function showAudit(env, telegram, chatId, messageId) {
  const entries = await getRecentAudit(env.BOT_KV, 20);
  if (entries.length === 0) {
    await telegram.editOrSend(chatId, messageId, "فعالیتی ثبت نشده است.", {
      reply_markup: keyboard([], { back: "admin:main" }),
    });
    return;
  }
  const lines = entries
    .filter(Boolean)
    .map((e) => `👤 ${e.admin_id} — ⚡ ${e.action} — 🎯 ${JSON.stringify(e.target)}`);

  await telegram.editOrSend(chatId, messageId, `📝 <b>گزارش فعالیت اخیر</b>\n\n${lines.join("\n")}`, {
    reply_markup: keyboard([], { back: "admin:main" }),
  });
}
