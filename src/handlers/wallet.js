import { keyboard } from "../lib/keyboards.js";
import { setState, clearState } from "../lib/state.js";
import { getUser, getSettings, createPayment, getAdmins } from "../lib/kv.js";

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

  await telegram.editOrSend(chatId, messageId, "روش شارژ کیف پول را انتخاب کنید:", {
    reply_markup: keyboard(buttons, { perRow: 1, back: "wallet:main" }),
  });
}

export async function showGatewayNotice(env, telegram, chatId, messageId) {
  // Not wired to a real gateway yet. When you pick one (Zarinpal, IDPay,
  // NextPay, etc.), add an adapter file and a webhook route in index.js to
  // receive the bank's callback and credit the wallet.
  await telegram.editOrSend(
    chatId,
    messageId,
    "🌐 پرداخت آنلاین هنوز به درگاه واقعی متصل نشده است. فعلاً از کارت‌به‌کارت استفاده کنید.",
    { reply_markup: keyboard([{ text: "💳 کارت‌به‌کارت", data: "wallet:charge:card" }], { perRow: 1, back: "wallet:charge" }) }
  );
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
    await setState(env, userId, { step: "await_custom_amount" });
    await telegram.editOrSend(chatId, messageId, "💰 مبلغ دلخواه خود را به تومان وارد کنید (فقط عدد):", {
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
    await telegram.sendMessage(
      chatId,
      `❌ مبلغ نامعتبر است. حداقل مبلغ شارژ ${toman(settings.min_charge)} می‌باشد.`
    );
    return;
  }
  await clearState(env, userId);
  await beginReceiptFlow(env, telegram, chatId, null, userId, amount);
}

async function beginReceiptFlow(env, telegram, chatId, messageId, userId, amount) {
  await setState(env, userId, { step: "await_receipt_photo", amount });
  await telegram.editOrSend(chatId, messageId, "📸 لطفاً تصویر رسید پرداخت را ارسال کنید.", {
    reply_markup: keyboard([], { back: "wallet:charge:card" }),
  });
}

export async function handleReceiptPhoto(env, telegram, message, state) {
  const chatId = message.chat.id;
  const userId = message.from.id;
  const photo = message.photo[message.photo.length - 1];

  const payment = await createPayment(env.BOT_KV, {
    user_id: userId,
    method: "card_to_card",
    amount: state.amount,
    receipt_file_id: photo.file_id,
  });

  await clearState(env, userId);
  await telegram.sendMessage(chatId, "⏳ رسید شما برای بررسی ارسال شد.");

  // Notify admins
  const admins = await getAdmins(env.BOT_KV);
  const caption =
    `🧾 رسید پرداخت جدید\n\n` +
    `👤 کاربر: ${userId}\n` +
    `💰 مبلغ: ${toman(state.amount)}\n` +
    `🆔 پرداخت: #${payment.id}`;
  const kb = keyboard(
    [
      { text: "✅ تأیید", data: `admin:pay:approve:${payment.id}` },
      { text: "❌ رد", data: `admin:pay:reject:${payment.id}` },
    ],
    { perRow: 2 }
  );
  for (const admin of admins) {
    await telegram.sendPhoto(admin.id, photo.file_id, { caption, reply_markup: kb });
  }
}

export async function showTransactions(env, telegram, chatId, messageId, userId) {
  const user = await getUser(env.BOT_KV, userId);
  const list = (user.transactions || []).slice(0, 15);
  if (list.length === 0) {
    await telegram.editOrSend(chatId, messageId, "تراکنشی ثبت نشده است.", {
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
