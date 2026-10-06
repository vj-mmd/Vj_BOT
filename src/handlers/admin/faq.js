import { keyboard } from "../../lib/keyboards.js";
import { setState, clearState } from "../../lib/state.js";
import { getFaqs, saveFaqs, addFaq, logAction } from "../../lib/kv.js";

// ─────────────────────────────────────────────
// ❓ سوالات متداول (FAQ) — admin CRUD
// ─────────────────────────────────────────────

export async function showFaqAdmin(env, telegram, chatId, messageId) {
  const faqs = await getFaqs(env.BOT_KV);
  const buttons = faqs.map((f) => ({ text: `❓ ${f.q}`, data: `admin:faq:view:${f.id}` }));
  buttons.push({ text: "➕ افزودن سوال جدید", data: "admin:faq:add" });

  await telegram.editOrSend(chatId, messageId, "❓ <b>مدیریت سوالات متداول</b>", {
    reply_markup: keyboard(buttons, { perRow: 1, back: "admin:settings" }),
  });
}

export async function showFaqDetailAdmin(env, telegram, chatId, messageId, id) {
  const faqs = await getFaqs(env.BOT_KV);
  const item = faqs.find((f) => f.id === id);
  if (!item) return;

  const buttons = [
    { text: "✏️ ویرایش سوال", data: `admin:faq:editfield:${id}:q` },
    { text: "✏️ ویرایش پاسخ", data: `admin:faq:editfield:${id}:a` },
    { text: "🗑 حذف", data: `admin:faq:delconfirm:${id}` },
  ];

  await telegram.editOrSend(chatId, messageId, `❓ <b>${item.q}</b>\n\n${item.a}`, {
    reply_markup: keyboard(buttons, { perRow: 1, back: "admin:faq" }),
  });
}

export async function promptAddFaq(env, telegram, chatId, messageId, adminId) {
  await setState(env, adminId, { step: "admin_faq_add_q" });
  await telegram.editOrSend(chatId, messageId, "❓ متن سوال جدید را ارسال کنید:", {
    reply_markup: keyboard([], { back: "admin:faq" }),
  });
}

export async function handleFaqAddInput(env, telegram, message, state) {
  const chatId = message.chat.id;
  const adminId = message.from.id;
  const raw = (message.text || "").trim();
  if (!raw) return;

  if (state.step === "admin_faq_add_q") {
    await setState(env, adminId, { step: "admin_faq_add_a", question: raw });
    await telegram.sendMessage(chatId, "✅ حالا متن پاسخ این سوال را ارسال کنید:", {
      reply_markup: keyboard([], { back: "admin:faq" }),
    });
    return;
  }

  // step === "admin_faq_add_a"
  await clearState(env, adminId);
  const id = await addFaq(env.BOT_KV, state.question, raw);
  await logAction(env.BOT_KV, adminId, "add_faq", id);

  await telegram.sendMessage(chatId, "✅ سوال جدید اضافه شد.", {
    reply_markup: keyboard([{ text: "📋 بازگشت", data: "admin:faq" }], { perRow: 1 }),
  });
}

export async function promptEditFaqField(env, telegram, chatId, messageId, adminId, id, field) {
  const faqs = await getFaqs(env.BOT_KV);
  const item = faqs.find((f) => f.id === id);
  if (!item) return;

  await setState(env, adminId, { step: "admin_faq_edit", id, field });
  const label = field === "q" ? "سوال" : "پاسخ";
  const current = field === "q" ? item.q : item.a;
  await telegram.editOrSend(
    chatId,
    messageId,
    `متن فعلی ${label}:\n\n${current}\n\n${label} جدید را ارسال کنید:`,
    { reply_markup: keyboard([], { back: `admin:faq:view:${id}` }) }
  );
}

export async function handleFaqEditInput(env, telegram, message, state) {
  const chatId = message.chat.id;
  const adminId = message.from.id;
  const raw = (message.text || "").trim();
  if (!raw) return;
  await clearState(env, adminId);

  const faqs = await getFaqs(env.BOT_KV);
  const item = faqs.find((f) => f.id === state.id);
  if (!item) return;

  if (state.field === "q") item.q = raw;
  else item.a = raw;
  await saveFaqs(env.BOT_KV, faqs);
  await logAction(env.BOT_KV, adminId, "edit_faq", { id: state.id, field: state.field });

  await telegram.sendMessage(chatId, "✅ بروزرسانی شد.", {
    reply_markup: keyboard([{ text: "📋 بازگشت", data: `admin:faq:view:${state.id}` }], { perRow: 1 }),
  });
}

export async function confirmDeleteFaq(env, telegram, chatId, messageId, id) {
  await telegram.editOrSend(chatId, messageId, "🗑 آیا از حذف این سوال مطمئن هستید؟", {
    reply_markup: keyboard(
      [
        { text: "✅ بله، حذف کن", data: `admin:faq:delete:${id}` },
        { text: "❌ انصراف", data: `admin:faq:view:${id}` },
      ],
      { perRow: 2 }
    ),
  });
}

export async function deleteFaq(env, telegram, chatId, messageId, adminId, id) {
  const faqs = await getFaqs(env.BOT_KV);
  const next = faqs.filter((f) => f.id !== id);
  await saveFaqs(env.BOT_KV, next);
  await logAction(env.BOT_KV, adminId, "delete_faq", id);
  await showFaqAdmin(env, telegram, chatId, messageId);
}
