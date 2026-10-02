import { keyboard } from "../lib/keyboards.js";
import { setState, clearState } from "../lib/state.js";
import { createTicket, getUserOpenTicket, saveTicket, getTicket, getAdmins, getUser, getTexts, getFaqs, getUserServices, getService } from "../lib/kv.js";
import { supportReply } from "../lib/ai.js";
import { logSupport } from "../lib/log.js";

export async function showSupportMenu(env, telegram, chatId, messageId) {
  const texts = await getTexts(env.BOT_KV);
  const settings = await (await import("../lib/kv.js")).getSettings(env.BOT_KV);
  const aiStatus = settings.support_ai_enabled && settings.groq_api_key ? "🟢 آماده" : "🔴 تنظیم نشده";
  const text = `${texts.support_menu}\n\n` +
    `🤖 <b>پشتیبانی هوشمند:</b> ${aiStatus}\n` +
    `پاسخ سریع برای سوالات خرید، کیف پول، سرویس و مشکلات رایج.\n\n` +
    `برای ارتباط مستقیم با اپراتور هم می‌توانی تیکت ثبت کنی.`;
  const kb = keyboard(
    [
      { text: "پشتیبانی هوشمند", data: "support:ai" },
      { text: "سوالات متداول", data: "support:faq" },
      { text: "ارتباط با اپراتور", data: "support:ticket" },
    ],
    { perRow: 1, back: "menu:main" }
  );
  await telegram.editOrSend(chatId, messageId, text, { reply_markup: kb });
}


export async function startAISupport(env, telegram, chatId, messageId, userId) {
  const settings = await (await import("../lib/kv.js")).getSettings(env.BOT_KV);
  if (!settings.support_ai_enabled || !settings.groq_api_key) {
    await telegram.editOrSend(chatId, messageId,
      "<b>پشتیبانی هوشمند در دسترس نیست</b>\n\nتنظیمات هوش مصنوعی هنوز کامل نشده است. از گزینه ارتباط با اپراتور استفاده کنید.",
      { reply_markup: keyboard([{ text: "ارتباط با اپراتور", data: "support:ticket" }], { perRow: 1, back: "support:main" }) }
    );
    return;
  }
  await setState(env, userId, { step: "await_support_ai", history: [] });
  await telegram.editOrSend(chatId, messageId,
    "<b>پشتیبانی هوشمند آنلاین</b>\n\n" +
    "سؤال خود را همین‌جا بنویسید. درباره خرید، کیف پول، سرویس‌ها، تمدید و خطاهای رایج راهنمایی‌تان می‌کنم.\n\n" +
    "اگر نیاز به بررسی انسانی دارید، بنویسید «اپراتور».",
    { reply_markup: keyboard([{ text: "ارتباط با اپراتور", data: "support:ticket" }], { perRow: 1, back: "support:main" }) }
  );
}

export async function handleAISupportMessage(env, telegram, message, state) {
  const chatId = message.chat.id;
  const userId = message.from.id;
  const text = (message.text || "").trim();
  if (!text) {
    await telegram.sendMessage(chatId, "لطفاً سؤال خود را به صورت متنی ارسال کنید.");
    return;
  }
  const normalized = text.toLowerCase();
  if (["اپراتور", "پشتیبان", "پشتیبانی انسانی", "human", "operator"].some((x) => normalized.includes(x))) {
    await clearState(env, userId);
    return startTicketFlow(env, telegram, chatId, null, userId);
  }

  const kv = env.BOT_KV;
  const user = await getUser(kv, userId);
  const services = await getUserServices(kv, userId);
  const serviceSummary = services.slice(0, 6).map((s) => {
    const leftGb = Math.max(0, Number(s.volume_gb || 0) - Number(s.used_gb || 0));
    const status = s.status === "disabled" ? "disabled" : (Date.now() > Number(s.expires_at || 0) ? "expired" : "active");
    return `#${s.id}: ${status}, ${leftGb.toFixed(2)}GB left`;
  }).join("; ") || "no services";
  const faqs = await getFaqs(kv);
  const faqContext = faqs.slice(0, 8).map((f) => `Q: ${f.q}\nA: ${f.a}`).join("\n---\n");
  const context = [
    `User id: ${userId}`,
    `Balance: ${Number(user?.balance || 0).toLocaleString("en-US")} toman`,
    `Services: ${serviceSummary}`,
    faqContext ? `FAQ knowledge:\n${faqContext}` : "",
  ].filter(Boolean).join("\n");

  try {
    await telegram.sendChatAction?.(chatId, "typing");
  } catch {}
  try {
    const reply = await supportReply(env, text, context, state.history || []);
    if (!reply) throw new Error("Empty AI support response");
    const history = [...(state.history || []), { role: "user", content: text }, { role: "assistant", content: reply }].slice(-8);
    await setState(env, userId, { step: "await_support_ai", history });
    await telegram.sendMessage(chatId, reply, {
      reply_markup: keyboard([
        { text: "اپراتور انسانی", data: "support:ticket" },
        { text: "پاک کردن گفتگو", data: "support:ai:reset" },
      ], { perRow: 1 }),
    });
  } catch (e) {
    console.log("AI support failed", e?.stack || e);
    await telegram.sendMessage(chatId,
      "فعلاً پاسخ هوشمند در دسترس نیست. می‌توانید همین حالا با اپراتور انسانی ارتباط بگیرید.",
      { reply_markup: keyboard([{ text: "ارتباط با اپراتور", data: "support:ticket" }], { perRow: 1 }) }
    );
  }
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
