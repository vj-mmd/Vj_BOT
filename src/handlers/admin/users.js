import { keyboard, confirmKeyboard } from "../../lib/keyboards.js";
import { setState, clearState } from "../../lib/state.js";
import {
  getUser,
  saveUser,
  findUserByUsername,
  addTransaction,
  getUserServices,
  getUserOrders,
  logAction,
} from "../../lib/kv.js";

export async function showUsersMenu(env, telegram, chatId, messageId) {
  await telegram.editOrSend(chatId, messageId, "👥 <b>مدیریت کاربران</b>", {
    reply_markup: keyboard([{ text: "🔎 جستجوی کاربر", data: "admin:users:search" }], {
      perRow: 1,
      back: "admin:main",
    }),
  });
}

export async function promptSearch(env, telegram, chatId, messageId, adminId) {
  await setState(env, adminId, { step: "admin_search_user" });
  await telegram.editOrSend(chatId, messageId, "🔎 آیدی عددی، یوزرنیم یا نام کاربر را ارسال کنید:", {
    reply_markup: keyboard([], { back: "admin:users" }),
  });
}

export async function handleSearchInput(env, telegram, message) {
  const chatId = message.chat.id;
  const adminId = message.from.id;
  const q = (message.text || "").trim();
  await clearState(env, adminId);

  let user = null;
  if (/^\d+$/.test(q)) user = await getUser(env.BOT_KV, parseInt(q, 10));
  if (!user) user = await findUserByUsername(env.BOT_KV, q);

  if (!user) {
    await telegram.sendMessage(chatId, "❌ کاربری یافت نشد.", {
      reply_markup: keyboard([], { back: "admin:users" }),
    });
    return;
  }
  await sendUserCard(env, telegram, chatId, null, user.id);
}

export async function sendUserCard(env, telegram, chatId, messageId, userId) {
  const user = await getUser(env.BOT_KV, userId);
  if (!user) return;

  const text =
    `👤 <b>کاربر ${user.id}</b>\n\n` +
    `یوزرنیم: @${user.username || "-"}\n` +
    `نام: ${user.first_name || "-"}\n` +
    `💰 موجودی: ${user.balance.toLocaleString("en-US")} تومان\n` +
    `🎁 تست‌های استفاده‌شده: ${user.test_used}\n` +
    `وضعیت: ${user.banned ? "🚫 مسدود" : "✅ فعال"}`;

  const buttons = [
    user.banned
      ? { text: "✅ رفع مسدودی", data: `admin:user:unban:${user.id}` }
      : { text: "🚫 مسدود کردن", data: `admin:user:ban:${user.id}` },
    { text: "💰 افزایش موجودی", data: `admin:user:credit:${user.id}` },
    { text: "💸 کاهش موجودی", data: `admin:user:debit:${user.id}` },
    { text: "🎁 Reset تست", data: `admin:user:resettest:${user.id}` },
    { text: "📦 سرویس‌های کاربر", data: `admin:user:services:${user.id}` },
    { text: "🛒 سفارش‌های کاربر", data: `admin:user:orders:${user.id}` },
  ];

  await telegram.editOrSend(chatId, messageId, text, { reply_markup: keyboard(buttons, { back: "admin:users" }) });
}

export async function toggleBan(env, telegram, chatId, messageId, adminId, userId, ban) {
  const user = await getUser(env.BOT_KV, userId);
  if (!user) return;
  user.banned = ban;
  await saveUser(env.BOT_KV, user);
  await logAction(env.BOT_KV, adminId, ban ? "ban_user" : "unban_user", userId);
  await sendUserCard(env, telegram, chatId, messageId, userId);
}

export async function resetTest(env, telegram, chatId, messageId, adminId, userId) {
  const user = await getUser(env.BOT_KV, userId);
  if (!user) return;
  user.test_used = 0;
  await saveUser(env.BOT_KV, user);
  await logAction(env.BOT_KV, adminId, "reset_test", userId);
  await sendUserCard(env, telegram, chatId, messageId, userId);
}

export async function promptBalanceAmount(env, telegram, chatId, messageId, adminId, userId, direction) {
  await setState(env, adminId, { step: "admin_balance_amount", user_id: userId, direction });
  await telegram.editOrSend(
    chatId,
    messageId,
    `💰 مبلغ مورد نظر برای ${direction === "credit" ? "افزایش" : "کاهش"} موجودی را وارد کنید (تومان):`,
    { reply_markup: keyboard([], { back: `admin:user:card:${userId}` }) }
  );
}

export async function handleBalanceAmountInput(env, telegram, message, state) {
  const chatId = message.chat.id;
  const adminId = message.from.id;
  const amount = parseInt((message.text || "").replace(/[^\d]/g, ""), 10);
  await clearState(env, adminId);

  if (!amount) {
    await telegram.sendMessage(chatId, "❌ مبلغ نامعتبر است.");
    return;
  }

  const signed = state.direction === "credit" ? amount : -amount;
  await addTransaction(env.BOT_KV, state.user_id, {
    type: "admin_adjust",
    amount: signed,
    description: `اصلاح دستی توسط ادمین ${adminId}`,
  });
  await logAction(env.BOT_KV, adminId, "adjust_balance", { user_id: state.user_id, amount: signed });

  await telegram.sendMessage(chatId, "✅ موجودی بروزرسانی شد.");
  await sendUserCard(env, telegram, chatId, null, state.user_id);
}

export async function showUserServices(env, telegram, chatId, messageId, userId) {
  const services = await getUserServices(env.BOT_KV, userId);
  const lines = services.filter(Boolean).map((s) => `#${s.id} — ${s.username} — ${s.volume_gb}GB`);
  await telegram.editOrSend(
    chatId,
    messageId,
    lines.length ? lines.join("\n") : "این کاربر سرویسی ندارد.",
    { reply_markup: keyboard([], { back: `admin:user:card:${userId}` }) }
  );
}

export async function showUserOrders(env, telegram, chatId, messageId, userId) {
  const orders = await getUserOrders(env.BOT_KV, userId);
  const lines = orders.map((o) => `#${o.id} — ${o.price.toLocaleString("en-US")} تومان — ${o.status}`);
  await telegram.editOrSend(
    chatId,
    messageId,
    lines.length ? lines.join("\n") : "این کاربر سفارشی ندارد.",
    { reply_markup: keyboard([], { back: `admin:user:card:${userId}` }) }
  );
}
