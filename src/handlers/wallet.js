import { keyboard } from "../lib/keyboards.js";
import { setState, clearState } from "../lib/state.js";
import {
  getUser, getSettings, getTexts, render, createPayment, savePayment, getAdmins,
  getPaymentByReceiptHash, claimReceiptHash, getPaymentByReceiptFileId, claimReceiptFileId,
  getPaymentByReceiptReference, claimReceiptReference,
} from "../lib/kv.js";
import { logWalletCharge } from "../lib/log.js";
import { analyzeReceipt, downloadTelegramImage } from "../lib/ai.js";

function toman(n) {
  return n.toLocaleString("en-US") + " تومان";
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

  // Download and fingerprint the exact Telegram image before creating a new
  // payment. A receipt image is globally single-use, regardless of user.
  let imageDataUrl = null;
  let receiptHash = null;
  try {
    const downloaded = await downloadTelegramImage(env, telegram, photo.file_id);
    imageDataUrl = downloaded.dataUrl;
    receiptHash = downloaded.sha256;
  } catch (e) {
    console.log("RECEIPT IMAGE DOWNLOAD ERROR", e?.stack || e);
    const payment = await createPayment(kv, {
      user_id: userId,
      method: "card_to_card",
      amount: state.amount,
      card_last4: state.card_last4 || null,
      receipt_file_id: photo.file_id,
      ai_status: "review",
      ai_result: { decision: "review", reason: "receipt image could not be downloaded" },
    });
    await clearState(env, userId);
    await telegram.sendMessage(chatId, texts.wallet_receipt_received);
    await notifyAdminsForReview(env, telegram, payment, photo.file_id, userId, state, "خطا در دریافت تصویر رسید");
    return;
  }

  // Exact image replay check. This is intentionally global: the same receipt
  // must never credit two payments or two users.
  const previousByHash = await getPaymentByReceiptHash(kv, receiptHash);
  const previousByFileId = await getPaymentByReceiptFileId(kv, photo.file_id);
  const previousReceipt = previousByHash || previousByFileId;
  if (previousReceipt) {
    await clearState(env, userId);
    await telegram.sendMessage(
      chatId,
      previousReceipt.status === "approved"
        ? "❌ این تصویر رسید قبلاً برای یک پرداخت استفاده و تأیید شده است. کیف پول دوباره شارژ نمی‌شود."
        : "❌ این تصویر رسید قبلاً ثبت شده است و امکان استفاده مجدد از آن وجود ندارد."
    );
    return;
  }

  const payment = await createPayment(kv, {
    user_id: userId,
    method: "card_to_card",
    amount: state.amount,
    card_last4: state.card_last4 || null,
    receipt_file_id: photo.file_id,
    receipt_sha256: receiptHash,
    ai_status: settings.receipt_ai_enabled ? "processing" : "review",
  });
  const hashClaimed = await claimReceiptHash(kv, receiptHash, payment.id);
  const fileClaimed = await claimReceiptFileId(kv, photo.file_id, payment.id);
  if (!hashClaimed || !fileClaimed) {
    const existing = (await getPaymentByReceiptHash(kv, receiptHash)) || (await getPaymentByReceiptFileId(kv, photo.file_id));
    await clearState(env, userId);
    await telegram.sendMessage(chatId, existing?.status === "approved"
      ? "❌ این رسید قبلاً استفاده و تأیید شده است. کیف پول دوباره شارژ نمی‌شود."
      : "❌ این رسید قبلاً ثبت شده و قابل استفاده مجدد نیست.");
    return;
  }
  await clearState(env, userId);
  await telegram.sendMessage(chatId, texts.wallet_receipt_received);

  let ai = null;
  try {
    if (settings.receipt_ai_enabled) {
      ai = await analyzeReceipt(env, {
        imageDataUrl,
        expected: {
          amount: state.amount,
          card_last4: state.card_last4 || null,
          card_holder: settings.card_holder,
          shop_card: settings.card_number,
        },
      });
      payment.ai_result = ai;
      payment.ai_status = ai.decision;
      if (ai.reference) {
        const previousByReference = await getPaymentByReceiptReference(kv, ai.reference);
        if (previousByReference && previousByReference.id !== payment.id) {
          payment.ai_status = "reject";
          payment.ai_result = {
            ...ai,
            decision: "reject",
            reason: "شماره مرجع/پیگیری این رسید قبلاً استفاده شده است.",
          };
          await savePayment(kv, payment);
          const { rejectPayment } = await import("./admin/payments.js");
          await rejectPayment(env, telegram, chatId, 0, payment.id, true);
          return;
        }
        const referenceClaimed = await claimReceiptReference(kv, ai.reference, payment.id);
        if (!referenceClaimed) {
          payment.ai_status = "reject";
          payment.ai_result = {
            ...ai,
            decision: "reject",
            reason: "شماره مرجع/پیگیری این رسید قبلاً استفاده شده است.",
          };
          await savePayment(kv, payment);
          const { rejectPayment } = await import("./admin/payments.js");
          await rejectPayment(env, telegram, chatId, 0, payment.id, true);
          return;
        }
      }
      await savePayment(kv, payment);
    }
  } catch (e) {
    console.log("RECEIPT AI ERROR", e?.stack || e);
    payment.ai_status = "review";
    payment.ai_result = { decision: "review", reason: String(e?.message || e).slice(0, 500) };
    await savePayment(kv, payment);
  }

  // Hard verification rules are independent of admin status. An admin account
  // and a regular account go through exactly the same receipt decision path.
  if (ai?.decision === "approve") {
    const amountOK = Number(ai.amount_toman) === Number(state.amount);
    const cardOK = !state.card_last4 || normalizeDigits(ai.card_last4) === normalizeDigits(state.card_last4);
    const relatedOK = ai.related === true;
    const confidenceOK = Number(ai.confidence || 0) >= 0.85;
    if (amountOK && cardOK && relatedOK && confidenceOK) {
      payment.auto_approved = true;
      await savePayment(kv, payment);
      const { approvePayment } = await import("./admin/payments.js");
      await approvePayment(env, telegram, chatId, 0, payment.id, true);
      return;
    }
    // AI cannot override the hard rules. A genuine receipt with an unreadable
    // field goes to manual review rather than being silently rejected.
    payment.ai_status = "review";
    payment.ai_result = {
      ...ai,
      decision: "review",
      reason: "AI approval failed hard verification rules (amount/card/related/confidence).",
    };
    await savePayment(kv, payment);
  }

  if (ai?.decision === "reject" && settings.receipt_auto_reject_unrelated !== false) {
    payment.auto_rejected = true;
    await savePayment(kv, payment);
    const { rejectPayment } = await import("./admin/payments.js");
    await rejectPayment(env, telegram, chatId, 0, payment.id, true);
    return;
  }

  // Only genuine uncertainty reaches admins. API failures are explicitly
  // labelled as such so they cannot be mistaken for a rejected receipt.
  await notifyAdminsForReview(
    env,
    telegram,
    payment,
    photo.file_id,
    userId,
    state,
    ai?.reason || (settings.receipt_ai_enabled ? "AI بررسی قطعی ارائه نکرد" : "بررسی خودکار رسید خاموش است")
  );
}

function normalizeDigits(value) {
  return String(value ?? "")
    .replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
}

async function notifyAdminsForReview(env, telegram, payment, fileId, userId, state, reason) {
  const admins = await getAdmins(env.BOT_KV);
  const caption =
    `⚠️ رسید نیازمند بررسی دستی\n\n` +
    `👤 کاربر: ${userId}\n💰 مبلغ: ${state.amount.toLocaleString("en-US")} تومان\n` +
    `💳 ۴ رقم کارت: ${state.card_last4 || "-"}\n🆔 پرداخت: #${payment.id}\n` +
    `🤖 دلیل: ${String(reason).slice(0, 500)}`;
  const kb = keyboard([
    { text: "✅ تأیید", data: `admin:pay:approve:${payment.id}` },
    { text: "❌ رد", data: `admin:pay:reject:${payment.id}` },
  ], { perRow: 2 });
  for (const admin of admins) {
    await telegram.sendPhoto(admin.id, fileId, { caption, reply_markup: kb });
  }
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
