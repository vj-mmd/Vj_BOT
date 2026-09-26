// Posts a public activity line to the report channel configured in
// settings.report_channel_id — the "هر کی خرید/شارژ کرد اینجا اعلام میشه"
// transparency channel (Eitemaad-style). Does nothing if unset, and never
// throws into the caller's flow if Telegram rejects the send (e.g. bot not
// admin in that channel yet).

import { getSettings } from "./kv.js";

// Cache the bot username so we don't call getMe on every report.
let cachedBotUsername = null;

async function getBotUsername(telegram) {
  if (cachedBotUsername) return cachedBotUsername;
  try {
    const me = await telegram.getMe();
    cachedBotUsername = me.username || null;
  } catch (e) {
    console.log("getMe failed", e);
  }
  return cachedBotUsername;
}

async function orderKeyboard(telegram) {
  const username = await getBotUsername(telegram);
  if (!username) return undefined; // no button if we can't resolve username
  return {
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: "🛒 ثبت سفارش",
            url: `https://t.me/${username}?start=order`,
          },
        ],
      ],
    },
  };
}

async function postReport(env, telegram, lines, withButton = false) {
  const settings = await getSettings(env.BOT_KV);
  if (!settings.report_channel_id) return;
  const text = lines.filter(Boolean).join("\n");
  try {
    const extra = withButton ? await orderKeyboard(telegram) : {};
    await telegram.sendMessage(settings.report_channel_id, text, {
      parse_mode: "HTML",
      ...extra,
    });
  } catch (e) {
    console.log("report channel post failed", e);
  }
}

function nowTehran() {
  const now = new Date();
  const tehran = new Date(
    now.toLocaleString("en-US", { timeZone: "Asia/Tehran" })
  );
  const p = (n) => String(n).padStart(2, "0");
  return `${tehran.getFullYear()}/${p(tehran.getMonth() + 1)}/${p(
    tehran.getDate()
  )} - ${p(tehran.getHours())}:${p(tehran.getMinutes())}`;
}

export async function reportPurchase(env, telegram, user, product, price) {
  await postReport(
    env,
    telegram,
    [
      "گزارش خرید موفق✅",
      "",
      `👀خریدار : <code>${user.id}</code>`,
      `🛍سفارش : ${product.name}`,
      `💵مبلغ پرداخت شده : ${price.toLocaleString("en-US")} تومان`,
      `⏱تاریخ و ساعت : ${nowTehran()}`,
    ],
    true
  );
}

export async function reportRenewal(env, telegram, user, product, price) {
  await postReport(
    env,
    telegram,
    [
      "گزارش تمدید موفق✅",
      "",
      `👀خریدار : <code>${user.id}</code>`,
      `🛍سفارش : ${product.name}`,
      `💵مبلغ پرداخت شده : ${price.toLocaleString("en-US")} تومان`,
      `⏱تاریخ و ساعت : ${nowTehran()}`,
    ],
    true
  );
}

export async function reportWalletCharge(env, telegram, user, amount) {
  await postReport(env, telegram, [
    "💳 <b>شارژ کیف پول</b>",
    "",
    `👤 نام: ${user.first_name || "-"}`,
    `🔢 آیدی عددی: <code>${user.id}</code>`,
    `💰 مبلغ شارژ: ${amount.toLocaleString("en-US")} تومان`,
  ]);
}
