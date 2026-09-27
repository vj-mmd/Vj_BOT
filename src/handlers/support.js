import { keyboard } from "../lib/keyboards.js";
import { setState, clearState } from "../lib/state.js";
import { createTicket, getUserOpenTicket, saveTicket, getTicket, getAdmins, getUser, getTexts, getFaqs } from "../lib/kv.js";
import { logSupport } from "../lib/log.js";

export async function showSupportMenu(env, telegram, chatId, messageId) {
  const texts = await getTexts(env.BOT_KV);
  const kb = keyboard(
    [
      { text: "❓ سوالات متداول", data: "support:faq" },
      { text: "👨‍💻 پشتیبانی آنلاین", data: "support:ticket" },
    ],
    { back: "menu:main" }
  );
  await telegram.editOrSend(chatId, messageId, texts.support_menu, { reply_markup: kb });
}

export async function showFaqList(env, telegram, chatId, messageId) {
  const faqs = await getFaqs(env.BOT_KV);
  if (faqs.length === 0) {
    const texts = await getTexts(env.BOT_KV);
    await telegram.editOrSend(chatId, messageId, texts.faq_empty, {
      reply_markup: keyboard([], { back: "support:main" }),
    });
    return;
  }
  const buttons = faqs.map((f) => ({ text: `❓ ${f.q}`, data: `support:faq:${f.id}` }));
  await telegram.editOrSend(chatId, messageId, "❓ <b>سوالات متداول</b>", {
    reply_markup: keyboard(buttons, { perRow: 1, back: "support:main" }),
  });
}

export async function showFaqAnswer(env, telegram, chatId, messageId, id) {
  const faqs = await getFaqs(env.BOT_KV);
  const item = faqs.find((f) => f.id === id);
  if (!item) return;
  await telegram.editOrSend(chatId, messageId, `❓ ${item.q}\n\n${item.a}`, {
    reply_markup: keyboard([], { back: "support:faq" }),
  });
}

export async function startTicketFlow(env, telegram, chatId, messageId, userId) {
  const texts = await getTexts(env.BOT_KV);
  const existing = await getUserOpenTicket(env.BOT_KV, userId);
  if (existing) {
    await telegram.editOrSend(chatId, messageId, texts.support_ticket_prompt, {
      reply_markup: keyboard([], { back: "support:main" }),
    });
    await setState(env, userId, { step: "await_ticket_message", ticket_id: existing.id });
    return;
  }
  await setState(env, userId, { step: "await_ticket_message" });
  await telegram.editOrSend(chatId, messageId, texts.support_ticket_prompt, {
    reply_markup: keyboard([], { back: "support:main" }),
  });
}

export async function handleTicketMessageInput(env, telegram, message, state) {
  const chatId = message.chat.id;
  const userId = message.from.id;
  const text = message.text || "(پیام غیرمتنی)";
  const kv = env.BOT_KV;
  const texts = await getTexts(kv);

  let ticket;
  if (state.ticket_id) {
    ticket = await getTicket(kv, state.ticket_id);
    ticket.messages.push({ from: "user", text, at: Date.now() });
    ticket.status = "open";
    await saveTicket(kv, ticket);
  } else {
    ticket = await createTicket(kv, { user_id: userId, first_message: text });
  }
  await clearState(env, userId);

  await telegram.sendMessage(chatId, texts.support_ticket_sent);

  // 📊 لاگ: پشتیبانی
  try {
    const user = await getUser(kv, userId);
    if (user) {
      await logSupport(env, telegram, user, text);
    }
  } catch (e) {
    console.log("logSupport failed", e);
  }

  const admins = await getAdmins(kv);
  const kb = keyboard([{ text: "✍️ پاسخ", data: `admin:ticket:reply:${ticket.id}` }], { perRow: 1 });
  for (const admin of admins) {
    await telegram.sendMessage(
      admin.id,
      `💬 تیکت جدید #${ticket.id}\n👤 کاربر: ${userId}\n\n${text}`,
      { reply_markup: kb }
    );
  }
}
