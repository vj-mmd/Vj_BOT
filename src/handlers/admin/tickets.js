import { keyboard } from "../../lib/keyboards.js";
import { setState, clearState } from "../../lib/state.js";
import { getOpenTickets, getTicket, saveTicket, removeFromIndex, logAction } from "../../lib/kv.js";

export async function showOpenTickets(env, telegram, chatId, messageId) {
  const tickets = await getOpenTickets(env.BOT_KV);
  if (tickets.length === 0) {
    await telegram.editOrSend(chatId, messageId, "تیکت بازی وجود ندارد.", {
      reply_markup: keyboard([], { back: "admin:main" }),
    });
    return;
  }
  const buttons = tickets
    .filter(Boolean)
    .map((t) => ({ text: `#${t.id} — کاربر ${t.user_id}`, data: `admin:ticket:view:${t.id}` }));

  await telegram.editOrSend(chatId, messageId, "💬 <b>تیکت‌های باز</b>", {
    reply_markup: keyboard(buttons, { perRow: 1, back: "admin:main" }),
  });
}

export async function showTicketDetail(env, telegram, chatId, messageId, ticketId) {
  const ticket = await getTicket(env.BOT_KV, ticketId);
  if (!ticket) return;
  const lines = ticket.messages.map((m) => `${m.from === "user" ? "👤" : "👨‍💻"} ${m.text}`);
  const buttons = [
    { text: "✍️ پاسخ", data: `admin:ticket:reply:${ticket.id}` },
    { text: "🔒 بستن تیکت", data: `admin:ticket:close:${ticket.id}` },
  ];
  await telegram.editOrSend(chatId, messageId, `💬 تیکت #${ticket.id}\n\n${lines.join("\n")}`, {
    reply_markup: keyboard(buttons, { back: "admin:tickets" }),
  });
}

export async function promptTicketReply(env, telegram, chatId, messageId, adminId, ticketId) {
  await setState(env, adminId, { step: "admin_ticket_reply", ticket_id: ticketId });
  await telegram.editOrSend(chatId, messageId, "پاسخ خود را ارسال کنید:", {
    reply_markup: keyboard([], { back: `admin:ticket:view:${ticketId}` }),
  });
}

export async function handleTicketReplyInput(env, telegram, message, state) {
  const chatId = message.chat.id;
  const adminId = message.from.id;
  const text = message.text || "";
  const kv = env.BOT_KV;
  await clearState(env, adminId);

  const ticket = await getTicket(kv, state.ticket_id);
  if (!ticket) return;
  ticket.messages.push({ from: "admin", text, at: Date.now() });
  ticket.status = "answered";
  await saveTicket(kv, ticket);

  await telegram.sendMessage(ticket.user_id, `👨‍💻 پاسخ پشتیبانی (تیکت #${ticket.id}):\n\n${text}`);
  await telegram.sendMessage(chatId, "✅ پاسخ ارسال شد.");
}

export async function closeTicket(env, telegram, chatId, messageId, adminId, ticketId) {
  const kv = env.BOT_KV;
  const ticket = await getTicket(kv, ticketId);
  if (!ticket) return;
  ticket.status = "closed";
  await saveTicket(kv, ticket);
  await removeFromIndex(kv, "index:tickets:open", ticketId);
  await logAction(kv, adminId, "close_ticket", ticketId);

  await telegram.sendMessage(ticket.user_id, `🔒 تیکت #${ticket.id} توسط پشتیبانی بسته شد.`);
  await showOpenTickets(env, telegram, chatId, messageId);
}
