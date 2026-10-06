import { keyboard, rows } from "../lib/keyboards.js";
import { setState, clearState } from "../lib/state.js";
import {
  getUser, getSettings, getTexts, render, createPayment, savePayment, getAdmins,
  getPaymentByReceiptHash, claimReceiptHashSafe, getPaymentByReceiptFileId, claimReceiptFileIdSafe,
  getPaymentByReceiptReference, claimReceiptReferenceSafe,
} from "../lib/kv.js";
import { logWalletCharge } from "../lib/log.js";
import { analyzeReceipt, downloadTelegramImage } from "../lib/ai.js";
import { requestPayment, verifyPayment, startUrl } from "../lib/gateway/zarinpal.js";
import { withUserLock } from "../lib/locks.js";
import { getPayment, resolvePayment, getStats, saveStats, claimPaymentCharge, addTransaction } from "../lib/kv.js";

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
  const buttons = [];
  const settings = await getSettings(env.BOT_KV);
  if (settings.features?.card_to_card !== false) buttons.push({ text: "💳 کارت‌به‌کارت", data: "wallet:charge:card" });
  if (settings.online_gateway_enabled && settings.features?.online_gateway !== false) buttons.push({ text: "🌐 پرداخت آنلاین", data: "wallet:charge:gateway" });

  const texts = await getTexts(env.BOT_KV);
  await telegram.editOrSend(chatId, messageId, texts.wallet_charge_method_prompt, {
    reply_markup: keyboard(buttons, { perRow: 1, back: "wallet:main" }),
  });
}

export async function showGatewayNotice(env, telegram, chatId, messageId) {
  const settings = await getSettings(env.BOT_KV); const texts = await getTexts(env.BOT_KV);
  if (!settings.online_gateway_enabled || !env.ZARINPAL_MERCHANT_ID) return telegram.editOrSend(chatId,messageId,texts.wallet_gateway_not_ready,{reply_markup:keyboard([{text:"💳 کارت‌به‌کارت",data:"wallet:charge:card"}],{perRow:1,back:"wallet:charge"})});
  return showKeypad(env, telegram, chatId, messageId, "g", 0);
}

const AMOUNT_OPTIONS = [100000, 200000, 500000, 1000000];

// ---------- numeric keypad for choosing the charge amount ----------
// Amount lives inside callback_data (wallet:kp:<mode>:<amount>:<action>), so no
// session state is needed. mode: c = card-to-card, g = online gateway.
const KEYPAD_MAX = 999999999;

async function showKeypad(env, telegram, chatId, messageId, mode, amount) {
  const settings = await getSettings(env.BOT_KV);
  const min = Number(settings.min_charge || 0);
  const cur = Math.min(KEYPAD_MAX, Math.max(0, Number(amount) || 0));
  const text =
    `⚡ <b>مبلغ مورد نظر را وارد کنید:</b>\n\n` +
    `حداقل شارژ: ${toman(min)}\n` +
    `مبلغ انتخاب شده: ${toman(cur)}`;
  const digit = (d) => ({ text: String(d), data: `wallet:kp:${mode}:${cur}:d${d}` });
  const inline_keyboard = [
    ...rows([1, 2, 3, 4, 5, 6, 7, 8, 9].map(digit), 3),
    ...rows([digit(0)], 1),
    ...rows([
      { text: "پاک کردن", data: `wallet:kp:${mode}:${cur}:clr`, style: "default" },
      { text: "تایید", data: `wallet:kp:${mode}:${cur}:ok`, style: "default" },
    ], 2),
    ...keyboard([], { back: "wallet:charge" }).inline_keyboard,
  ];
  await telegram.editOrSend(chatId, messageId, text, { reply_markup: { inline_keyboard } });
}

export async function handleKeypad(env, telegram, chatId, messageId, userId, callbackQueryId, mode, curToken, action) {
  const cur = Math.min(KEYPAD_MAX, Math.max(0, parseInt(curToken, 10) || 0));
  mode = mode === "g" ? "g" : "c";

  if (action === "ok") {
    const settings = await getSettings(env.BOT_KV);
    const min = Number(settings.min_charge || 0);
    if (!cur || cur < min) {
      return telegram.answerCallbackQuery(callbackQueryId, `❌ حداقل مبلغ شارژ ${toman(min)} می‌باشد.`, true);
    }
    await telegram.answerCallbackQuery(callbackQueryId, "");
    if (mode === "g") return startGatewayAmount(env, telegram, chatId, messageId, userId, cur);
    return beginReceiptFlow(env, telegram, chatId, messageId, userId, cur);
  }

  await telegram.answerCallbackQuery(callbackQueryId, "");
  let next = cur;
  if (action === "clr") next = 0;
  else if (/^d\d$/.test(action || "")) {
    const candidate = cur * 10 + Number(action[1]);
    if (candidate <= KEYPAD_MAX) next = candidate;
  }
  return showKeypad(env, telegram, chatId, messageId, mode, next);
}

export async function showCardToCard(env, telegram, chatId, messageId) {
  return showKeypad(env, telegram, chatId, messageId, "c", 0);
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
  const cardInfo =
    `💳 <b>اطلاعات پرداخت</b>\n\n` +
    `💰 مبلغ: ${toman(amount)}\n\n` +
    `شماره کارت:\n<code>${settings.card_number}</code>\n\n` +
    `به نام: ${settings.card_holder}\n\n`;
  if (settings.card_last4_required !== false) {
    await setState(env, userId, { step: "await_card_last4", amount });
    await telegram.editOrSend(chatId, messageId,
      cardInfo + "پس از واریز، لطفاً ۴ رقم آخر کارتی که با آن پرداخت کردید را ارسال کنید.",
      { reply_markup: keyboard([], { back: "wallet:charge:card" }) });
    return;
  }
  await setState(env, userId, { step: "await_receipt_photo", amount });
  await telegram.editOrSend(chatId, messageId, cardInfo + texts.wallet_receipt_prompt, {
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
  const rateKey = `rate:receipt:${userId}`;
  const now = Date.now();
  const recent = await kv.get(rateKey, "json");
  const attempts = Array.isArray(recent) ? recent.filter(t => now - t < 3600000) : [];
  if (attempts.length >= Number(settings.rate_limits?.receipt_per_hour || 5)) {
    await clearState(env, userId);
    await telegram.sendMessage(chatId, "⏳ تعداد ارسال رسید شما در یک ساعت اخیر زیاد بوده است. بعداً دوباره تلاش کنید.");
    return;
  }
  attempts.push(now); await kv.put(rateKey, JSON.stringify(attempts), { expirationTtl: 3600 });

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
    await telegram.sendMessage(chatId, texts.wallet_receipt_received, { reply_markup: keyboard([{ text: "🏠 منوی اصلی", data: "menu:main" }], { perRow: 1 }) });
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
  const hashClaimed = await claimReceiptHashSafe(env, receiptHash, payment.id);
  const fileClaimed = await claimReceiptFileIdSafe(env, photo.file_id, payment.id);
  if (!hashClaimed || !fileClaimed) {
    const existing = (await getPaymentByReceiptHash(kv, receiptHash)) || (await getPaymentByReceiptFileId(kv, photo.file_id));
    await clearState(env, userId);
    await telegram.sendMessage(chatId, existing?.status === "approved"
      ? "❌ این رسید قبلاً استفاده و تأیید شده است. کیف پول دوباره شارژ نمی‌شود."
      : "❌ این رسید قبلاً ثبت شده و قابل استفاده مجدد نیست.");
    return;
  }
  await clearState(env, userId);
  await telegram.sendMessage(chatId, texts.wallet_receipt_received, { reply_markup: keyboard([{ text: "🏠 منوی اصلی", data: "menu:main" }], { perRow: 1 }) });

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
        const referenceClaimed = await claimReceiptReferenceSafe(env, ai.reference, payment.id);
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
  const list = (user.transactions || []).slice(0, 5);
  if (list.length === 0) {
    await telegram.editOrSend(chatId, messageId, texts.wallet_no_transactions, {
      reply_markup: keyboard([], { back: "wallet:main" }),
    });
    return;
  }
  const buttons = list.map((t, i) => ({
    text: `🔹 تراکنش ${i + 1} • ${new Date(t.at || Date.now()).toLocaleDateString("fa-IR")}`,
    data: `wallet:tx:${i}`,
  }));
  await telegram.editOrSend(chatId, messageId,
    `📜 <b>تراکنش‌های اخیر کیف پول</b>\n\nبرای مشاهده جزئیات، یکی از ۵ تراکنش اخیر را انتخاب کنید.`,
    { reply_markup: keyboard(buttons, { perRow: 1, back: "wallet:main" }) });
}

export async function showTransactionDetail(env, telegram, chatId, messageId, userId, index) {
  const user = await getUser(env.BOT_KV, userId);
  const tx = (user?.transactions || [])[Number(index)];
  if (!tx) {
    await telegram.editOrSend(chatId, messageId, "این تراکنش دیگر در دسترس نیست.", {
      reply_markup: keyboard([], { back: "wallet:tx" }),
    });
    return;
  }
  const amount = Number(tx.amount || 0);
  const text =
    `🧾 <b>جزئیات تراکنش ${Number(index) + 1}</b>\n\n` +
    `🏷 نوع: ${String(tx.type || "نامشخص")}\n` +
    `📝 شرح: ${String(tx.description || "—")}\n` +
    `💵 مبلغ: ${amount >= 0 ? "+" : ""}${amount.toLocaleString("en-US")} تومان\n` +
    `💰 موجودی قبل: ${Number(tx.balance_before || 0).toLocaleString("en-US")} تومان\n` +
    `💳 موجودی بعد: ${Number(tx.balance_after ?? user.balance ?? 0).toLocaleString("en-US")} تومان\n` +
    `🕒 تاریخ: ${new Date(tx.at || Date.now()).toLocaleString("fa-IR")}`;
  await telegram.editOrSend(chatId, messageId, text, {
    reply_markup: keyboard([{ text: "📜 بازگشت به تراکنش‌ها", data: "wallet:tx" }], { back: "wallet:main" }),
  });
}


export async function startGatewayAmount(env,telegram,chatId,messageId,userId,amount) {
  const settings=await getSettings(env.BOT_KV); const texts=await getTexts(env.BOT_KV); const n=Number(amount);
  if(!Number.isFinite(n)||n<Number(settings.min_charge||0)) return telegram.editOrSend(chatId,messageId,render(texts.wallet_custom_amount_invalid,{min:toman(settings.min_charge)}),{reply_markup:keyboard([], {back:"wallet:charge:gateway"})});
  const user=await getUser(env.BOT_KV,userId);
  await telegram.editOrSend(chatId,messageId,`🌐 <b>تأیید پرداخت آنلاین</b>\n\n💰 مبلغ: ${toman(n)}\n💼 موجودی فعلی: ${toman(user.balance)}\n\nبا تأیید به صفحه بانک منتقل می‌شوید.`,{reply_markup:keyboard([{text:"💳 رفتن به درگاه",data:`wallet:gateway:go:${n}`}],{perRow:1,back:"wallet:charge:gateway"})});
}
export async function startGatewayPayment(env,telegram,chatId,messageId,userId,amount){
 const n=Number(amount); const payment=await createPayment(env.BOT_KV,{user_id:userId,method:"zarinpal",amount:n,ai_status:"not_applicable"});
 const callbackUrl=`${env.PUBLIC_BASE_URL||""}/payments/zarinpal/callback`;
 if(!env.PUBLIC_BASE_URL) { await telegram.editOrSend(chatId,messageId,"❌ آدرس عمومی بازگشت درگاه تنظیم نشده است. متغیر <code>PUBLIC_BASE_URL</code> را در Wrangler تنظیم کنید.",{reply_markup:keyboard([], {back:"wallet:charge:gateway"})}); return; }
 try{const authority=await requestPayment(env,{amount:n,callbackUrl,description:`شارژ کیف پول #${payment.id}`,metadata:{payment_id:String(payment.id),user_id:String(userId)}});payment.authority=authority;await savePayment(env.BOT_KV,payment);await telegram.editOrSend(chatId,messageId,"🌐 درگاه پرداخت آماده است.\n\nپس از پرداخت، کیف پول شما به‌صورت خودکار شارژ می‌شود.",{reply_markup:keyboard([{text:"💳 پرداخت امن",url:startUrl(env,authority)}],{perRow:1,back:"wallet:charge"})});}
 catch(e){payment.status="rejected";payment.gateway_error=String(e);await savePayment(env.BOT_KV,payment);await resolvePayment(env.BOT_KV,payment.id);await telegram.editOrSend(chatId,messageId,"❌ ایجاد پرداخت آنلاین ناموفق بود. لطفاً دوباره تلاش کنید.",{reply_markup:keyboard([], {back:"wallet:charge:gateway"})});}
}
export async function handleZarinpalCallback(env,telegram,url){
 const authority=url.searchParams.get("Authority"),status=url.searchParams.get("Status"); if(!authority)return new Response("missing authority",{status:400});
 const kv=env.BOT_KV; const ids=await (await import("../lib/kv.js")).getIndex(kv,"index:payments:pending"); const payments=await Promise.all(ids.map(id=>getPayment(kv,id))); const payment=payments.find(p=>p?.authority===authority);
 if(!payment)return new Response("payment not found",{status:404});
 if(status!=="OK") {payment.status="rejected";await savePayment(kv,payment);await resolvePayment(kv,payment.id);return new Response("پرداخت لغو شد. می‌توانید به ربات برگردید.",{status:200,headers:{"content-type":"text/plain;charset=utf-8"}});}
 const verified=await verifyPayment(env,payment.amount,authority);if(!verified)return new Response("payment verification failed",{status:400});
 await withUserLock(env,payment.user_id,async()=>{const fresh=await getPayment(kv,payment.id);if(!fresh||fresh.status!=="pending")return;fresh.status="approved";fresh.ref_id=verified.ref_id;await savePayment(kv,fresh);await resolvePayment(kv,fresh.id);await addTransaction(kv,fresh.user_id,{type:"charge",amount:fresh.amount,description:"شارژ کیف پول (درگاه زرین‌پال)"});const st=await getStats(kv);st.total_charge+=fresh.amount;await saveStats(kv,st);const chargedUser=await getUser(kv,fresh.user_id);if(chargedUser){const {reportWalletCharge}=await import("../lib/report.js");const {logWalletCharge}=await import("../lib/log.js");await reportWalletCharge(env,telegram,chargedUser,fresh.amount);await logWalletCharge(env,telegram,chargedUser,fresh.amount);}await telegram.sendMessage(fresh.user_id,`✅ پرداخت آنلاین با موفقیت تأیید شد.\n💰 مبلغ ${toman(fresh.amount)} به کیف پول شما اضافه شد.`);});
 return new Response("پرداخت با موفقیت انجام شد. به ربات برگردید.",{status:200,headers:{"content-type":"text/plain;charset=utf-8"}});
}

export async function handleGatewayCustomAmountInput(env,telegram,message){
 const n=Number((message.text||"").replace(/[^\d]/g,"")); await clearState(env,message.from.id); return startGatewayAmount(env,telegram,message.chat.id,null,message.from.id,n);
}
