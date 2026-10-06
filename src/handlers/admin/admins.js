import { keyboard } from "../../lib/keyboards.js";
import { setState, clearState } from "../../lib/state.js";
import { getAdmins, saveAdmins, logAction } from "../../lib/kv.js";

const ROLE_LABEL = { owner: "👑 Owner", manager: "🛠 Manager", support: "🎧 Support" };

export async function showAdminsList(env, telegram, chatId, messageId) {
  const admins = await getAdmins(env.BOT_KV);
  const buttons = admins.map((a) => ({ text: `${ROLE_LABEL[a.role]} — ${a.id}`, data: `admin:admin:view:${a.id}` }));
  buttons.push({ text: "➕ افزودن Admin", data: "admin:admin:add" });

  await telegram.editOrSend(chatId, messageId, "👨‍💼 <b>مدیریت ادمین‌ها</b>", {
    reply_markup: keyboard(buttons, { perRow: 1, back: "admin:main" }),
  });
}

export async function promptAddAdmin(env, telegram, chatId, messageId, ownerId) {
  await setState(env, ownerId, { step: "admin_add_admin_id" });
  await telegram.editOrSend(chatId, messageId, "آیدی عددی کاربر را ارسال کنید:", {
    reply_markup: keyboard([], { back: "admin:admins" }),
  });
}

export async function handleAdminIdInput(env, telegram, message) {
  const chatId = message.chat.id;
  const ownerId = message.from.id;
  const id = parseInt((message.text || "").trim(), 10);
  if (Number.isNaN(id)) {
    await telegram.sendMessage(chatId, "❌ آیدی نامعتبر است.");
    return;
  }
  await setState(env, ownerId, { step: "admin_add_admin_role_pending", target_id: id });
  const buttons = [
    { text: "🛠 Manager", data: `admin:admin:add:role:manager` },
    { text: "🎧 Support", data: `admin:admin:add:role:support` },
  ];
  await telegram.sendMessage(chatId, "نقش این ادمین چیست؟", { reply_markup: keyboard(buttons, { perRow: 2 }) });
}

export async function finishAddAdmin(env, telegram, chatId, messageId, ownerId, role, targetId) {
  const admins = await getAdmins(env.BOT_KV);
  if (!admins.find((a) => a.id === targetId)) {
    admins.push({ id: targetId, role });
    await saveAdmins(env.BOT_KV, admins);
    await logAction(env.BOT_KV, ownerId, "add_admin", { id: targetId, role });
  }
  await clearState(env, ownerId);
  await telegram.editOrSend(chatId, messageId, `✅ کاربر ${targetId} به عنوان ${ROLE_LABEL[role]} اضافه شد.`, {
    reply_markup: keyboard([{ text: "📋 بازگشت", data: "admin:admins" }], { perRow: 1 }),
  });
}

export async function showAdminDetail(env, telegram, chatId, messageId, targetId) {
  const admins = await getAdmins(env.BOT_KV);
  const a = admins.find((x) => x.id === targetId);
  if (!a) return;
  const buttons = [];
  if (a.role !== "owner") buttons.push({ text: "🗑 حذف Admin", data: `admin:admin:remove:${targetId}` });
  await telegram.editOrSend(chatId, messageId, `${ROLE_LABEL[a.role]}\nآیدی: ${a.id}`, {
    reply_markup: keyboard(buttons, { perRow: 1, back: "admin:admins" }),
  });
}

export async function removeAdmin(env, telegram, chatId, messageId, ownerId, targetId, callbackQueryId) {
  const admins = await getAdmins(env.BOT_KV);
  const target = admins.find((a) => a.id === targetId);
  if (target && target.role === "owner") {
    await telegram.answerCallbackQuery(callbackQueryId, "❌ نمی‌توان Owner را حذف کرد.", true);
    return;
  }
  await telegram.answerCallbackQuery(callbackQueryId, "");
  const next = admins.filter((a) => a.id !== targetId);
  await saveAdmins(env.BOT_KV, next);
  await logAction(env.BOT_KV, ownerId, "remove_admin", targetId);
  await showAdminsList(env, telegram, chatId, messageId);
}
