// src/handlers/support.js
import { keyboard } from "../lib/keyboards.js";
import { setState, clearState } from "../lib/state.js";
import {
  createTicket,
  getUserOpenTicket,
  saveTicket,
  getTicket,
  getAdmins,
} from "../lib/kv.js";

const FAQ = [
  { q: "نحوه اتصال چگونه است؟", a: "لینک Subscription خود را در اپلیکیشن کلاینت (v2rayNG، Streisand، ...) وارد کنید." },
  { q: "حجم سرویس چگونه محاسبه می‌شود؟", a: "مجموع آپلود و دانلود شما از سرویس کسر می‌شود." },
  { q: "Subscription چیست؟", a: "لینکی که تمام کانفیگ‌های سرویس شما را یکجا در اختیار کلاینت قرار می‌دهد." },
  { q: "چرا سرویس وصل نمی‌شود؟", a: "از منقضی نشدن تاریخ و اتمام حجم سرویس مطمئن شوید و اتصال اینترنت خود را بررسی کنید." },
];

const BACK_TO_SUPPORT = { back: "support:main" };

export async function showSupportMenu(env, telegram, chatId, messageId) {
  const kb = keyboard(
    [
      { text: "❓ سوالات متداول", data: "support:faq" },
      { text: "👨‍💻 پشتیبانی آنلاین", data: "support:ticket" },
    ],
    { back: "menu:main" }
  );
  await telegram.editOrSend(chatId, messageId, "☎️ بخش پشتیبانی را انتخاب کنید:", { reply_markup: kb });
}

export async function showFaqList(env, telegram, chatId, messageId) {
  const buttons = FAQ.map((f, i) => ({ text: `❓ ${f.q}`, data: `support:faq:${i}` }));
  await telegram.editOrSend(chatId, messageId, "❓ <b>سوالات متداول</b>", {
    reply_markup: keyboard(buttons, { perRow: 1, back: "support:main" }),
  });
}

export async function showFaqAnswer(env, telegram, chatId, messageId, index) {
  const item = FAQ[Number(index)];
  if (!item) {
    await telegram.editOrSend(chatId, messageId, "❓ سوال مورد نظر یافت نشد.", {
      reply_markup: keyboard([], BACK_TO_SUPPORT),
    });
    return;
  }
  await telegram.editOrSend(chatId, messageId, `❓ ${item.q}\n\n${item.a}`, {
    reply_markup: keyboard([], { back: "support:faq" }),
  });
}

export async function startTicketFlow(env, telegram, chatId, messageId, userId) {
  const existing = await getUserOpenTicket(env.BOT_KV, userId);

  if (existing) {
    await telegram.editOrSend(
      chatId,
      messageId,
      `شما یک تیکت باز دارید (#${existing.id}). پیام بعدی شما به همان تیکت اضافه می‌شود.`,
      { reply_markup: keyboard([], BACK_TO_SUPPORT) }
    );
    await setState(env, userId, { step: "await_ticket_message", ticket_id: existing.id });
    return;
  }

  await setState(env, userId, { step: "await_ticket_message" });
  await telegram.editOrSend(chatId, messageId, "👨‍💻 پیام خود را برای پشتیبانی ارسال کنید:", {
    reply_markup: keyboard([], BACK_TO_SUPPORT),
  });
}

export async function handleTicketMessageInput(env, telegram, message, state) {
  const chatId = message.chat.id;
  const userId = message.from.id;
  const text = message.text || "(پیام غیرمتنی)";
  const kv = env.BOT_KV;

  let ticket;

  if (state.ticket_id) {
    ticket = await getTicket(kv, state.ticket_id);
  }

  if (ticket) {
    ticket.messages.push({ from: "user", text, at: Date.now() });
    ticket.status = "open";
    await saveTicket(kv, ticket);
  } else {
    // تیکت قبلی پیدا نشد یا کاربر تیکت باز نداشت → تیکت جدید بساز
    ticket = await createTicket(kv, { user_id: userId, first_message: text });
  }

  await clearState(env, userId);

  // تأیید به کاربر
  try {
    await telegram.sendMessage(chatId, "✅ پیام شما برای پشتیبانی ارسال شد.");
  } catch (e) {
    console.error(`ارسال تأیید به کاربر ${userId} ناموفق:`, e.message);
  }

  // اطلاع به ادمین‌ها (هر ارسال جدا، تا خطای یکی بقیه رو قطع نکنه)
  let admins = [];
  try {
    admins = await getAdmins(kv);
  } catch (e) {
    console.error("دریافت لیست ادمین‌ها ناموفق:", e.message);
  }

  const kb = keyboard([{ text: "✍️ پاسخ", data: `admin:ticket:reply:${ticket.id}` }], { perRow: 1 });

  for (const admin of admins) {
    try {
      await telegram.sendMessage(
        admin.id,
        `💬 تیکت جدید #${ticket.id}\n👤 کاربر: ${userId}\n\n${text}`,
        { reply_markup: kb }
      );
    } catch (e) {
      console.error(`ارسال به ادمین ${admin.id} ناموفق:`, e.message);
    }
  }
}
