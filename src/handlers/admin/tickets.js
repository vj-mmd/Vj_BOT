[04/07/1405 08:36 ب.ظ] Vj: import { keyboard } from "../../lib/keyboards.js";
import { setState, clearState } from "../../lib/state.js";
import {
  getOpenTickets,
  getTicket,
  saveTicket,
  logAction,
} from "../../lib/kv.js";

export async function showOpenTickets(
  env,
  telegram,
  chatId,
  messageId
) {
  const tickets = await getOpenTickets(
    env.BOT_KV
  );

  if (tickets.length === 0) {
    await telegram.editOrSend(
      chatId,
      messageId,
      "تیکت بازی وجود ندارد.",
      {
        reply_markup: keyboard([], {
          back: "admin:main",
        }),
      }
    );
    return;
  }

  const buttons = tickets.map((ticket) => ({
    text: #${ticket.id} — کاربر ${ticket.user_id},
    data: admin:ticket:view:${ticket.id},
  }));

  await telegram.editOrSend(
    chatId,
    messageId,
    "💬 <b>تیکت‌های باز</b>",
    {
      reply_markup: keyboard(buttons, {
        perRow: 1,
        back: "admin:main",
      }),
    }
  );
}

export async function showTicketDetail(
  env,
  telegram,
  chatId,
  messageId,
  ticketId
) {
  const ticket = await getTicket(
    env.BOT_KV,
    ticketId
  );

  if (!ticket) {
    await telegram.editOrSend(
      chatId,
      messageId,
      "❌ تیکت پیدا نشد.",
      {
        reply_markup: keyboard([], {
          back: "admin:tickets",
        }),
      }
    );
    return;
  }

  const lines = ticket.messages.map((m) => {
    const icon =
      m.from === "user"
        ? "👤"
        : "👨‍💻";

    return ${icon} ${m.text};
  });

  const buttons = [
    {
      text: "✍️ پاسخ",
      data: admin:ticket:reply:${ticket.id},
    },
    {
      text: "🔒 بستن تیکت",
      data: admin:ticket:close:${ticket.id},
    },
  ];

  await telegram.editOrSend(
    chatId,
    messageId,
    💬 <b>تیکت #${ticket.id}</b>\n\n${lines.join("\n\n")},
    {
      reply_markup: keyboard(buttons, {
        perRow: 1,
        back: "admin:tickets",
      }),
    }
  );
}

export async function promptTicketReply(
  env,
  telegram,
  chatId,
  messageId,
  adminId,
  ticketId
) {
  const ticket = await getTicket(
    env.BOT_KV,
    ticketId
  );

  if (!ticket) {
    await telegram.editOrSend(
      chatId,
      messageId,
      "❌ تیکت پیدا نشد.",
      {
        reply_markup: keyboard([], {
          back: "admin:tickets",
        }),
      }
    );
    return;
  }

  if (ticket.status === "closed") {
    await telegram.editOrSend(
      chatId,
      messageId,
      "🔒 این تیکت بسته شده است.",
      {
        reply_markup: keyboard([], {
          back: admin:ticket:view:${ticket.id},
        }),
      }
    );
    return;
  }

  await setState(env, adminId, {
    step: "admin_ticket_reply",
    ticket_id: Number(ticketId),
  });

  await telegram.editOrSend(
    chatId,
    messageId,
    "✍️ پاسخ خود را ارسال کنید:",
    {
      reply_markup: keyboard([], {
        back: admin:ticket:view:${ticket.id},
      }),
    }
  );
}

export async function handleTicketReplyInput(
  env,
  telegram,
  message,
  state
) {
  const chatId = message.chat.id;
  const adminId = message.from.id;
  const text =
    message.text?.trim() ||
    "(پیام غیرمتنی)";

  const kv = env.BOT_KV;

  await clearState(
    env,
    adminId
  );

  const ticket = await getTicket(
    kv,
    state.ticket_id
  );

  if (!ticket) {
    await telegram.sendMessage(
      chatId,
      "❌ تیکت پیدا نشد."
    );
    return;
  }

  if (ticket.status === "closed") {
    await telegram.sendMessage(
      chatId,
      "🔒 این تیکت قبلاً بسته شده است."
    );
    return;
  }

  ticket.messages.push({
    from: "admin",
    text,
    admin_id: adminId,
    at: Date.now(),
  });

  ticket.status = "open";
  ticket.last_admin_reply_at =
    Date.now();

  await saveTicket(
    kv,
    ticket
  );

  const userKeyboard = keyboard(
    [
      {
        text: "مشکلم حل شد ✅",
        data: ticket:close:${ticket.id},
      },
      {
        text: "مشکلم حل نشد ❌",
        data: ticket:reopen:${ticket.id},
      },
    ],
    {
      perRow: 1,
    }
  );
[04/07/1405 08:36 ب.ظ] Vj: await telegram.sendMessage(
    ticket.user_id,
    ☎️ <b>پیام پشتیبانی:</b>\n\n${text},
    {
      reply_markup: userKeyboard,
    }
  );

  await telegram.sendMessage(
    chatId,
    "✅ پاسخ برای کاربر ارسال شد."
  );

  await logAction(
    kv,
    adminId,
    "reply_ticket",
    ticket.id
  );
}

export async function closeTicket(
  env,
  telegram,
  chatId,
  messageId,
  adminId,
  ticketId
) {
  const kv = env.BOT_KV;

  const ticket = await getTicket(
    kv,
    ticketId
  );

  if (!ticket) {
    await telegram.sendMessage(
      chatId,
      "❌ تیکت پیدا نشد."
    );
    return;
  }

  ticket.status = "closed";
  ticket.closed_at = Date.now();
  ticket.closed_by = adminId;

  await saveTicket(
    kv,
    ticket
  );

  await logAction(
    kv,
    adminId,
    "close_ticket",
    ticket.id
  );

  await telegram.sendMessage(
    ticket.user_id,
    🔒 تیکت #${ticket.id} توسط پشتیبانی بسته شد.
  );

  await showOpenTickets(
    env,
    telegram,
    chatId,
    messageId
  );
}
