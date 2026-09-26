// Posts a public activity line to the report channel configured in
// settings.report_channel_id — the "هر کی خرید/شارژ کرد اینجا اعلام میشه"
// transparency channel (Eitemaad-style). Does nothing if unset, and never
// throws into the caller's flow if Telegram rejects the send (e.g. bot not
// admin in that channel yet).

import { getSettings } from "./kv.js";

async function postReport(env, telegram, lines) {
  const settings = await getSettings(env.BOT_KV);
  if (!settings.report_channel_id) return;
  const text = lines.filter(Boolean).join("\n");
  try {
    await telegram.sendMessage(settings.report_channel_id, text);
  } catch (e) {
    console.log("report channel post failed", e);
  }
}

function userLines(user) {
  return [
    `👤 نام: ${user.first_name || "-"}`,
    `🆔 آیدی: ${user.username ? "@" + user.username : "-"}`,
    `🔢 آیدی عددی: <code>${user.id}</code>`,
  ];
}

export async function reportPurchase(env, telegram, user, product, price) {
  await postReport(env, telegram, [
    "🛍 <b>خرید جدید</b>",
    "",
    ...userLines(user),
    `📦 محصول: ${product.name}`,
    `💰 مبلغ: ${price.toLocaleString("en-US")} تومان`,
  ]);
}

export async function reportRenewal(env, telegram, user, product, price) {
  await postReport(env, telegram, [
    "🔄 <b>تمدید سرویس</b>",
    "",
    ...userLines(user),
    `📦 محصول: ${product.name}`,
    `💰 مبلغ: ${price.toLocaleString("en-US")} تومان`,
  ]);
}

export async function reportWalletCharge(env, telegram, user, amount) {
  await postReport(env, telegram, [
    "💳 <b>شارژ کیف پول</b>",
    "",
    ...userLines(user),
    `💰 مبلغ شارژ: ${amount.toLocaleString("en-US")} تومان`,
  ]);
}
