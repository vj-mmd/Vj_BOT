import { getSettings, saveSettings } from "./kv.js";

const BLANK = "\u200B";

// تاپیک‌هایی که ربات خودش می‌سازه
const DEFAULT_TOPICS = [
  { key: "new_user",        name: "🆕 کاربران جدید" },
  { key: "test_account",    name: "🎁 اکانت تست" },
  { key: "purchase",        name: "🛒 خریدها" },
  { key: "renewal",         name: "🔄 تمدیدها" },
  { key: "wallet",          name: "💳 شارژ کیف پول" },
  { key: "failed_purchase", name: "⚠️ خرید ناموفق" },
  { key: "errors",          name: "🚨 خطاها" },
  { key: "support",         name: "📞 پشتیبانی" },
];

// ساخت خودکار تاپیک‌ها
export async function setupLogTopics(env, telegram, chatId) {
  const topics = {};
  for (const t of DEFAULT_TOPICS) {
    try {
      const res = await telegram.createForumTopic(chatId, t.name);
      console.log(`createForumTopic ${t.name} result:`, JSON.stringify(res));
      if (res.ok && res.result && res.result.message_thread_id) {
        topics[t.key] = res.result.message_thread_id;
      }
    } catch (e) {
      console.log(`failed to create topic ${t.name}`, e);
    }
  }
  console.log("TOPICS BUILT:", JSON.stringify(topics));

  // ذخیره فوری تو KV
  const settings = await getSettings(env.BOT_KV);
  settings.log_channel_id = String(chatId);
  settings.log_topics = topics;
  await saveSettings(env.BOT_KV, settings);
  console.log("TOPICS SAVED TO KV");

  return topics;
}

// ذخیره تنظیمات گروه لاگ
export async function setLogChannel(env, chatId) {
  const settings = await getSettings(env.BOT_KV);
  settings.log_channel_id = String(chatId);
  settings.log_topics = {};
  await saveSettings(env.BOT_KV, settings);
}

// ذخیره تاپیک‌ها
export async function setLogTopics(env, topics) {
  const settings = await getSettings(env.BOT_KV);
  settings.log_topics = topics;
  await saveSettings(env.BOT_KV, settings);
}

// تابع پایه ارسال به تاپیک
async function postToTopic(env, telegram, topicKey, lines) {
  const settings = await getSettings(env.BOT_KV);
  console.log("POST TO TOPIC:", JSON.stringify({
    topicKey,
    log_channel_id: settings.log_channel_id,
    log_topics: settings.log_topics,
    topic_id: settings.log_topics?.[topicKey],
  }));
  if (!settings.log_channel_id) return;
  const topicId = settings.log_topics?.[topicKey];
  if (!topicId) return;
  const text = lines.filter(Boolean).join("\n");
  try {
    const r = await telegram.sendMessage(settings.log_channel_id, text, {
      parse_mode: "HTML",
      message_thread_id: topicId,
    });
    console.log("POST RESULT:", JSON.stringify(r));
  } catch (e) {
    console.log("log topic post failed", e);
  }
}

// ─────── توابع لاگ ───────

function nowTehran() {
  const now = new Date();
  const tehran = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Tehran" }));
  const p = (n) => String(n).padStart(2, "0");
  return `${tehran.getFullYear()}/${p(tehran.getMonth() + 1)}/${p(tehran.getDate())} - ${p(tehran.getHours())}:${p(tehran.getMinutes())}`;
}

function userBlock(user) {
  return [
    `👤 نام: ${user.first_name || "-"}`,
    `🆔 آیدی: <code>${user.id}</code>`,
    `🔗 یوزرنیم: ${user.username ? "@" + user.username : "-"}`,
  ];
}

export async function logNewUser(env, telegram, user) {
  await postToTopic(env, telegram, "new_user", [
    "🆕 <b>کاربر جدید</b>",
    BLANK,
    ...userBlock(user),
    BLANK,
    `⏱ ${nowTehran()}`,
  ]);
}

export async function logTestAccount(env, telegram, user, product) {
  await postToTopic(env, telegram, "test_account", [
    "🎁 <b>اکانت تست</b>",
    BLANK,
    ...userBlock(user),
    `📦 محصول: ${product.name}`,
    BLANK,
    `⏱ ${nowTehran()}`,
  ]);
}

export async function logPurchase(env, telegram, user, product, price) {
  await postToTopic(env, telegram, "purchase", [
    "🛒 <b>خرید موفق</b>",
    BLANK,
    ...userBlock(user),
    `📦 محصول: ${product.name}`,
    `💰 مبلغ: ${price.toLocaleString("en-US")} تومان`,
    BLANK,
    `⏱ ${nowTehran()}`,
  ]);
}

export async function logRenewal(env, telegram, user, product, price) {
  await postToTopic(env, telegram, "renewal", [
    "🔄 <b>تمدید موفق</b>",
    BLANK,
    ...userBlock(user),
    `📦 محصول: ${product.name}`,
    `💰 مبلغ: ${price.toLocaleString("en-US")} تومان`,
    BLANK,
    `⏱ ${nowTehran()}`,
  ]);
}

export async function logWalletCharge(env, telegram, user, amount) {
  await postToTopic(env, telegram, "wallet", [
    "💳 <b>شارژ کیف پول</b>",
    BLANK,
    ...userBlock(user),
    `💰 مبلغ: ${amount.toLocaleString("en-US")} تومان`,
    BLANK,
    `⏱ ${nowTehran()}`,
  ]);
}

export async function logFailedPurchase(env, telegram, user, product, reason) {
  await postToTopic(env, telegram, "failed_purchase", [
    "⚠️ <b>خرید ناموفق</b>",
    BLANK,
    ...userBlock(user),
    `📦 محصول: ${product?.name || "-"}`,
    `❗ دلیل: ${reason || "-"}`,
    BLANK,
    `⏱ ${nowTehran()}`,
  ]);
}

export async function logError(env, telegram, source, error) {
  await postToTopic(env, telegram, "errors", [
    "🚨 <b>خطا</b>",
    BLANK,
    `📍 منبع: <code>${source}</code>`,
    `❗ متن: <code>${String(error).slice(0, 500)}</code>`,
    BLANK,
    `⏱ ${nowTehran()}`,
  ]);
}

export async function logSupport(env, telegram, user, message) {
  await postToTopic(env, telegram, "support", [
    "📞 <b>درخواست پشتیبانی</b>",
    BLANK,
    ...userBlock(user),
    `💬 پیام: ${message}`,
    BLANK,
    `⏱ ${nowTehran()}`,
  ]);
}
