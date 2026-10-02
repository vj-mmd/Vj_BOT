import { keyboard } from "../lib/keyboards.js";
import { setState, clearState } from "../lib/state.js";
import { getUser, getSettings, getTexts, render, createPayment, getAdmins } from "../lib/kv.js";
import { logWalletCharge } from "../lib/log.js";
import { analyzeReceipt, downloadTelegramImage } from "../lib/ai.js";

function toman(n) {
  return n.toLocaleString("en-US") + " تومان";
}

function withTimeout(promise, ms, label = "operation") {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timeout after ${ms}ms`)), ms)
    ),
  ]);
}

export async function showWallet(env, telegram, chatId, messageId, userId) {
  const user = await getUser(env.BOT_KV, userId);
  const text = `💸 <b>کیف پول شما</b>\n\n💰 موجودی: ${toman(user.balance)}`;
  const kb = keyboard(
    [
      { text: "💳 شارژ کیف پول", data: "wallet:charge" },
      { text: "📜 تراکنش‌ها", data: "wallet:tx" },
    ],
    { back: "menu:main" }
  );
  await telegram.editOrSend(chatId, messageId, text, { reply_markup: kb });
}

export async function showChargeOptions(env, telegram, chatId, messageId) {
  const buttons = [{ text: "💳 کارت‌به‌کارت", data: "wallet:charge:card" }];
  const settings = await getSettings(env.BOT_KV);
  if (settings.online_gateway_enabled) buttons.push({ text: "🌐 پرداخت آنلاین", data: "wallet:charge:gateway" });

  const texts = await getTexts(env.BOT_KV);
  await telegram.editOrSend(chatId, messageId, texts.wallet_charge_method_prompt, {
    reply_markup: keyboard(buttons, { perRow: 1, back: "wallet:main" }),
  });
}

export async function showGatewayNotice(env, telegram, chatId, messageId) {
  // Not wired to a real gateway yet. When you pick one (Zarinpal, IDPay,
  // NextPay, etc.), add an adapter file and a webhook route in index.js to
  // receive the bank's callback and credit the wallet.
  const texts = await getTexts(env.BOT_KV);
  await telegram.editOrSend(chatId, messageId, texts.wallet_gateway_not_ready, {
    reply_markup: keyboard([{ text: "💳 کارت‌به‌کارت", data: "wallet:charge:card" }], { perRow: 1, back: "wallet:charge" }),
  });
}

const AMOUNT_OPTIONS = [100000, 200000, 500000, 1000000];

export async function showCardToCard(env, telegram, chatId, messageId) {
  const settings = await getSettings(env.BOT_KV);
  const text =
    `💳 <b>اطلاعات پرداخت</b>\n\n` +
    `شماره کارت:\n<code>${settings.card_number}</code>\n\n` +
    `به نام: ${settings.card_holder}\n\n` +
    `مبلغ مورد نظر برای شارژ را انتخاب کنید:`;

  const buttons = AMOUNT_OPTIONS.map((a) => ({ text: toman(a), data: `wallet:amt:${a}` }));
  buttons.push({ text: "💰 مبلغ دلخواه", data: "wallet:amt:custom" });

  await telegram.editOrSend(chatId, messageId, text, {
    reply_markup: keyboard(buttons, { back: "wallet:charge" }),
  });
}

export async function handleAmountChosen(env, telegram, chatId, messageId, userId, amountToken) {
  if (amountToken === "custom") {
    const texts = await getTexts(env.BOT_KV);
    await setState(env, userId, { step: "await_custom_amount" });
    await telegram.editOrSend(chatId, messageId, texts.wallet_custom_amount_prompt, {
      reply_markup: keyboard([], { back: "wallet:charge:card" }),
    });
    return;
  }
  const amount = parseInt(amountToken, 10);
  await beginReceiptFlow(env, telegram, chatId, messageId, userId, amount);
}

export async function handleCustomAmountInput(env, telegram, message) {
  const chatId = message.chat.id;
  const userId = message.from.id;
  const amount = parseInt((message.text || "").replace(/[^\d]/g, ""), 10);
  const settings = await getSettings(env.BOT_KV);

  if (!amount || amount < settings.min_charge) {
    const texts = await getTexts(env.BOT_KV);
    await telegram.sendMessage(chatId, render(texts.wallet_custom_amount_invalid, { min: toman(settings.min_charge) }));
    return;
  }
  await clearState(env, userId);
  await beginReceiptFlow(env, telegram, chatId, null, userId, amount);
}

async function beginReceiptFlow(env, telegram, chatId, messageId, userId, amount) {
  const texts = await getTexts(env.BOT_KV);
  const settings = await getSettings(env.BOT_KV);
  if (settings.card_last4_required !== false) {
    await setState(env, userId, { step: "await_card_last4", amount });
    await telegram.editOrSend(chatId, messageId,
      "💳 لطفاً ۴ رقم آخر کارتی که با آن پرداخت می‌کنید را ارسال کنید.",
      { reply_markup: keyboard([], { back: "wallet:charge:card" }) });
    return;
  }
  await setState(env, userId, { step: "await_receipt_photo", amount });
  await telegram.editOrSend(chatId, messageId, texts.wallet_receipt_prompt, {
    reply_markup: keyboard([], { back: "wallet:charge:card" }),
  });
}

export async function handleCardLast4Input(env, telegram, message, state) {
  const digits = (message.text || "").replace(/\D/g, "");
  if (!/^\d{4}$/.test(digits)) {
    return telegram.sendMessage(message.chat.id, "❌ دقیقاً ۴ رقم آخر کارت را بفرستید.");
  }
  const texts = await getTexts(env.BOT_KV);
  await setState(env, message.from.id, { step: "await_receipt_photo", amount: state.amount, card_last4: digits });
  await telegram.sendMessage(message.chat.id, texts.wallet_receipt_prompt, {
    reply_markup: keyboard([], { back: "wallet:charge:card" }),
  });
}

export async function handleReceiptPhoto(env, telegram, message, state) {
  const chatId = message.chat.id;
  const userId = message.from.id;
  const photo = message.photo[message.photo.length - 1];
  const kv = env.BOT_KV;
  const settings = await getSettings(kv);
  const texts = await getTexts(kv);

  const payment = await createPayment(kv, {
    user_id: userId,
    method: "card_to_card",
    amount: state.amount,
    card_last4: state.card_last4 || null,
    receipt_file_id: photo.file_id,
    ai_status: settings.receipt_ai_enabled ? "processing" : "review",
  });

  await clearState(env, userId);
  await telegram.sendMessage(chatId, texts.wallet_receipt_received);

  let ai = null;
  if (settings.receipt_ai_enabled) {
    try {
      // Never let Telegram file download or AI verification hang indefinitely.
      // If either step times out, the payment is safely sent to manual review.
      const imageDataUrl = await withTimeout(
        downloadTelegramImage(env, telegram, photo.file_id),
        20000,
        "Telegram receipt download"
      );

      const user = await getUser(kv, userId);

      ai = await withTimeout(
        analyzeReceipt(env, {
          imageDataUrl,
          expected: {
            amount: state.amount,
            card_last4: state.card_last4 || null,
            card_holder: settings.card_holder,
            shop_card: settings.card_number,
          },
        }),
        30000,
        "Receipt AI analysis"
      );
      payment.ai_result = ai;
      payment.ai_status = ai.decision;
      await savePayment(kv, payment);
    } catch (e) {
      payment.ai_status = "review";
      payment.ai_result = { decision: "review", reason: String(e).slice(0, 300) };
      await savePayment(kv, payment);
    }
  }

  // Hard rules always override AI: exact expected amount/card are required for approval.
  if (ai?.decision === "approve") {
    const amountOK = Number(ai.amount) === Number(state.amount);
    const cardOK = !state.card_last4 || String(ai.card_last4 || "") === String(state.card_last4);
    const relatedOK = ai.related !== false;
    if (amountOK && cardOK && relatedOK && Number(ai.confidence || 0) >= 0.85) {
      // Mark approved here; actual balance update lives in the shared admin function.
      payment.auto_approved = true;
      await savePayment(kv, payment);
      const { approvePayment } = await import("./admin/payments.js");
      await approvePayment(env, telegram, chatId, 0, payment.id, true);
      return;
    }
  }

  if (ai?.decision === "reject" && settings.receipt_auto_reject_unrelated !== false) {
    payment.auto_rejected = true;
    await savePayment(kv, payment);
    const { rejectPayment } = await import("./admin/payments.js");
    await rejectPayment(env, telegram, chatId, 0, payment.id, true);
    return;
  }

  // Uncertain receipts go to admins for manual review.
  const admins = await getAdmins(kv);
  const caption =
    `⚠️ رسید نیازمند بررسی دستی\n\n` +
    `👤 کاربر: ${userId}\n💰 مبلغ: ${state.amount.toLocaleString("en-US")} تومان\n` +
    `💳 ۴ رقم کارت: ${state.card_last4 || "-"}\n🆔 پرداخت: #${payment.id}\n` +
    `${ai?.reason ? `🤖 دلیل AI: ${ai.reason}` : "🤖 AI: بررسی انجام نشد"}`;
  const kb = keyboard([
    { text: "✅ تأیید", data: `admin:pay:approve:${payment.id}` },
    { text: "❌ رد", data: `admin:pay:reject:${payment.id}` },
  ], { perRow: 2 });
  for (const admin of admins) await telegram.sendPhoto(admin.id, photo.file_id, { caption, reply_markup: kb });
}

export async function showTransactions(env, telegram, chatId, messageId, userId) {
  const user = await getUser(env.BOT_KV, userId);
  const texts = await getTexts(env.BOT_KV);
  const list = (user.transactions || []).slice(0, 15);
  if (list.length === 0) {
    await telegram.editOrSend(chatId, messageId, texts.wallet_no_transactions, {
      reply_markup: keyboard([], { back: "wallet:main" }),
    });
    return;
  }
  const lines = list.map((t) => {
    const sign = t.amount >= 0 ? "+" : "";
    const date = new Date(t.at).toLocaleDateString("fa-IR");
    return `${date} | ${t.description} | ${sign}${t.amount.toLocaleString("en-US")}`;
  });
  await telegram.editOrSend(chatId, messageId, `📜 <b>تراکنش‌های اخیر</b>\n\n${lines.join("\n")}`, {
    reply_markup: keyboard([], { back: "wallet:main" }),
  });
}
