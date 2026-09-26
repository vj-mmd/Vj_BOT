import { keyboard } from "../../lib/keyboards.js";
import { getAdminRole, getAdmins, saveAdmins } from "../../lib/kv.js";

// First-run bootstrap: if no admins exist yet and this user matches the
// OWNER_ID secret, register them as Owner automatically. After that,
// admin management happens entirely through the /admin panel.
export async function requireAdmin(env, userId) {
  const role = await getAdminRole(env.BOT_KV, userId);
  if (role) return role;

  const admins = await getAdmins(env.BOT_KV);
  if (admins.length === 0 && env.OWNER_ID && String(userId) === String(env.OWNER_ID)) {
    await saveAdmins(env.BOT_KV, [{ id: userId, role: "owner" }]);
    return "owner";
  }
  return null;
}

export async function showAdminMenu(env, telegram, chatId, messageId, role) {
  const buttons = [
    { text: "👥 کاربران", data: "admin:users" },
    { text: "🛍 محصولات", data: "admin:products" },
    { text: "📂 دسته‌بندی‌ها", data: "admin:categories" },
    { text: "🖥 پنل‌ها", data: "admin:panels" },
    { text: "👤 پروفایل‌ها", data: "admin:profiles" },
    { text: "💳 پرداخت‌ها", data: "admin:payments" },
    { text: "🎟 تخفیف‌ها", data: "admin:discounts" },
    { text: "💰 کیف پول", data: "admin:wallet" },
    { text: "📢 Broadcast", data: "admin:broadcast" },
    { text: "📊 آمار", data: "admin:stats" },
    { text: "⚙️ تنظیمات", data: "admin:settings" },
    { text: "📢 کانال‌ها", data: "admin:channels" },
    { text: "💬 پشتیبانی", data: "admin:tickets" },
    { text: "📝 گزارش فعالیت", data: "admin:audit" },
  ];
  if (role === "owner") buttons.push({ text: "👨‍💼 ادمین‌ها", data: "admin:admins" });

  await telegram.editOrSend(chatId, messageId, "👨‍💼 <b>پنل مدیریت</b>", { reply_markup: keyboard(buttons, { perRow: 2 }) });
}
