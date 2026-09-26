[04/07/1405 08:33 ب.ظ] Vj: import { keyboard } from "../lib/keyboards.js";
import { setState, clearState } from "../lib/state.js";
import {
  createTicket,
  getUserOpenTicket,
  saveTicket,
  getTicket,
  getAdmins,
} from "../lib/kv.js";

const FAQ = [
  {
    q: "نحوه اتصال چگونه است؟",
    a: "لینک Subscription خود را در اپلیکیشن کلاینت (v2rayNG، Streisand، ...) وارد کنید.",
  },
  {
    q: "حجم سرویس چگونه محاسبه می‌شود؟",
    a: "مجموع آپلود و دانلود شما از سرویس کسر می‌شود.",
  },
  {
    q: "Subscription چیست؟",
    a: "لینکی که تمام کانفیگ‌های سرویس شما را یکجا در اختیار کلاینت قرار می‌دهد.",
  },
  {
    q: "چرا سرویس وصل نمی‌شود؟",
    a: "از منقضی نشدن تاریخ و اتمام حجم سرویس مطمئن شوید و اتصال اینترنت خود را بررسی کنید.",
  },
];

export async function showSupportMenu(
  env,
  telegram,
  chatId,
  messageId
) {
  const kb = keyboard(
    [
      {
        text: "❓ سوالات متداول",
        data: "support:faq",
      },
      {
        text: "👨‍💻 پشتیبانی آنلاین",
        data: "support:ticket",
      },
    ],
    {
      back: "menu:main",
    }
  );

  await telegram.editOrSend(
    chatId,
    messageId,
    "☎️ بخش پشتیبانی را انتخاب کنید:",
    {
      reply_markup: kb,
    }
  );
}

export async function showFaqList(
  env,
  telegram,
  chatId,
  messageId
) {
  const buttons = FAQ.map(
    (f, i) => ({
      text: ❓ ${f.q},
      data: support:faq:${i},
    })
  );

  await telegram.editOrSend(
    chatId,
    messageId,
    "❓ <b>سوالات متداول</b>",
    {
      reply_markup: keyboard(
        buttons,
        {
          perRow: 1,
          back: "support:main",
        }
      ),
    }
  );
}

export async function showFaqAnswer(
  env,
  telegram,
  chatId,
  messageId,
  index
) {
  const item = FAQ[index];

  if (!item) return;

  await telegram.editOrSend(
    chatId,
    messageId,
    ❓ ${item.q}\n\n${item.a},
    {
      reply_markup: keyboard(
        [],
        {
          back: "support:faq",
        }
      ),
    }
  );
}

export async function startTicketFlow(
  env,
  telegram,
  chatId,
  messageId,
  userId
) {
  const existing =
    await getUserOpenTicket(
      env.BOT_KV,
      userId
    );

  if (existing) {
    await setState(
      env,
      userId,
      {
        step: "await_ticket_message",
        ticket_id: Number(existing.id),
      }
    );

    await telegram.editOrSend(
      chatId,
      messageId,
      "☎️ شما یک تیکت باز دارید.\n\nپیام بعدی شما به همان تیکت اضافه می‌شود.",
      {
        reply_markup: keyboard(
          [],
          {
            back: "support:main",
          }
        ),
      }
    );

    return;
  }

  await setState(
    env,
    userId,
    {
      step: "await_ticket_message",
    }
  );

  await telegram.editOrSend(
    chatId,
    messageId,
    "👨‍💻 پیام خود را برای پشتیبانی ارسال کنید:",
    {
      reply_markup: keyboard(
        [],
        {
          back: "support:main",
        }
      ),
    }
  );
}

export async function handleTicketMessageInput(
  env,
  telegram,
  message,
  state
) {
  const chatId = message.chat.id;
  const userId = message.from.id;

  const text =
    message.text?.trim() ||
    "(پیام غیرمتنی)";

  const kv = env.BOT_KV;

  let ticket;

  if (state?.ticket_id) {
    ticket = await getTicket(
      kv,
      state.ticket_id
    );

    if (!ticket) {
      await clearState(
        env,
        userId
      );

      await telegram.sendMessage(
        chatId,
        "❌ تیکت پیدا نشد. لطفاً دوباره از بخش پشتیبانی اقدام کنید."
      );

      return;
    }

    if (ticket.user_id !== userId) {
      await clearState(
        env,
        userId
      );

      await telegram.sendMessage(
        chatId,
        "❌ این تیکت متعلق به شما نیست."
      );

      return;
    }

    if (ticket.status === "closed") {
      await clearState(
        env,
        userId
      );

      await telegram.sendMessage(
        chatId,
        "🔒 این تیکت بسته شده است. لطفاً از بخش پشتیبانی یک تیکت جدید ایجاد کنید."
      );

      return;
    }
[04/07/1405 08:33 ب.ظ] Vj: ticket.messages.push({
      from: "user",
      text,
      at: Date.now(),
    });

    ticket.status = "open";
    ticket.last_user_message_at =
      Date.now();

    await saveTicket(
      kv,
      ticket
    );
  } else {
    ticket = await createTicket(
      kv,
      {
        user_id: userId,
        first_message: text,
      }
    );
  }

  await clearState(
    env,
    userId
  );

  await telegram.sendMessage(
    chatId,
    "✅ پیام شما برای پشتیبانی ارسال شد."
  );

  const admins =
    await getAdmins(kv);

  const adminKeyboard = keyboard(
    [
      {
        text: "☎️ پاسخ",
        data: admin:ticket:reply:${ticket.id},
      },
    ],
    {
      perRow: 1,
    }
  );

  for (const admin of admins) {
    await telegram.sendMessage(
      admin.id,
      💬 <b>تیکت #${ticket.id}</b>\n👤 کاربر: ${userId}\n\n${text},
      {
        reply_markup: adminKeyboard,
      }
    );
  }
}

// کاربر می‌زند: مشکلم حل شد
export async function handleTicketClosedByUser(
  env,
  telegram,
  query,
  ticketId
) {
  const userId = query.from.id;
  const kv = env.BOT_KV;

  const ticket =
    await getTicket(
      kv,
      ticketId
    );

  if (!ticket) {
    await telegram.answerCallbackQuery(
      query.id,
      {
        text: "❌ تیکت پیدا نشد.",
        show_alert: true,
      }
    );
    return;
  }

  if (Number(ticket.user_id) !== Number(userId)) {
    await telegram.answerCallbackQuery(
      query.id,
      {
        text: "❌ این تیکت متعلق به شما نیست.",
        show_alert: true,
      }
    );
    return;
  }

  if (ticket.status === "closed") {
    await telegram.answerCallbackQuery(
      query.id,
      {
        text: "این تیکت قبلاً بسته شده است.",
      }
    );
    return;
  }

  ticket.status = "closed";
  ticket.closed_at = Date.now();
  ticket.closed_by = userId;

  await saveTicket(
    kv,
    ticket
  );

  await clearState(
    env,
    userId
  );

  await telegram.answerCallbackQuery(
    query.id,
    {
      text: "تیکت بسته شد ✅",
    }
  );

  await telegram.sendMessage(
    userId,
    "✅ مشکلتان حل شد و تیکت بسته شد.\n\nدر صورت نیاز می‌توانید دوباره با پشتیبانی تماس بگیرید."
  );
}

// کاربر می‌زند: مشکلم حل نشد
export async function handleTicketReopenByUser(
  env,
  telegram,
  query,
  ticketId
) {
  const userId = query.from.id;
  const kv = env.BOT_KV;

  const ticket =
    await getTicket(
      kv,
      ticketId
    );

  if (!ticket) {
    await telegram.answerCallbackQuery(
      query.id,
      {
        text: "❌ تیکت پیدا نشد.",
        show_alert: true,
      }
    );
    return;
  }

  if (Number(ticket.user_id) !== Number(userId)) {
    await telegram.answerCallbackQuery(
      query.id,
      {
        text: "❌ این تیکت متعلق به شما نیست.",
        show_alert: true,
      }
    );
    return;
  }

  if (ticket.status === "closed") {
    await telegram.answerCallbackQuery(
      query.id,
      {
        text: "این تیکت بسته شده است.",
      }
    );
    return;
  }

  // تیکت همچنان باز می‌ماند
  ticket.status = "open";

  await saveTicket(
    kv,
    ticket
  );

  await setState(
    env,
    userId,
    {
      step: "await_ticket_message",
      ticket_id: Number(ticket.id),
    }
  );

  await telegram.answerCallbackQuery(
    query.id,
    {
      text: "پیام جدید خود را ارسال کنید ✍️",
    }
  );

  await telegram.sendMessage(
    userId,
    "❌ مشکلتان حل نشده است.\n\nلطفاً پیام جدید خود را برای پشتیبانی ارسال کنید:"
  );
}
