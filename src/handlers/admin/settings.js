import { keyboard } from "../../lib/keyboards.js";
import { setState, clearState } from "../../lib/state.js";
import { getSettings, saveSettings, getTexts, saveTexts, logAction } from "../../lib/kv.js";
import { setupLogTopics, setLogChannel, setLogTopics } from "../../lib/log.js";
import { setCachedStyle } from "../../lib/styles.js";
import { BUTTON_STYLE_CATEGORIES } from "../../lib/buttonStyleRegistry.js";
import { TEXT_CATEGORIES } from "../../lib/textRegistry.js";

const SETTING_FIELDS = [
  { key: "min_charge", label: "💰 حداقل شارژ", numeric: true },
  { key: "ref_reward_percent", label: "🎁 پاداش دعوت (%)", numeric: true },
  { key: "test_count", label: "🎁 تعداد تست", numeric: true },
  { key: "test_volume_gb", label: "📦 حجم تست (GB)", numeric: true },
  { key: "test_duration_days", label: "⏳ مدت تست (روز)", numeric: true },
  { key: "card_number", label: "💳 شماره کارت", numeric: false },
  { key: "card_holder", label: "👤 نام صاحب کارت", numeric: false },
  { key: "support_id", label: "👨‍💻 آیدی پشتیبانی", numeric: false },
  { key: "report_channel_id", label: "📢 آیدی عددی کانال گزارش خرید/شارژ", numeric: false },
];

export async function showSettingsMenu(env, telegram, chatId, messageId) {
  const settings = await getSettings(env.BOT_KV);
  const buttons = SETTING_FIELDS.map((f) => ({ text: f.label, data: `admin:set:field:${f.key}` }));
  buttons.push({ text: "🌐 وضعیت درگاه آنلاین", data: "admin:set:gateway" });
  buttons.push({
    text: `🔌 وضعیت ربات: ${settings.bot_enabled === false ? "🔴 خاموش" : "🟢 روشن"}`,
    data: "admin:set:power",
  });
  buttons.push({ text: "🎨 رنگ دکمه‌ها", data: "admin:set:styles" });
  buttons.push({ text: "📝 متن‌های ربات", data: "admin:set:texts" });
  buttons.push({ text: "❓ سوالات متداول", data: "admin:faq" });
  buttons.push({ text: "📊 گروه لاگ", data: "admin:set:log" });

  await telegram.editOrSend(chatId, messageId, "⚙️ <b>تنظیمات</b>", {
    reply_markup: keyboard(buttons, { perRow: 1, back: "admin:main" }),
  });
}

export async function promptSettingValue(env, telegram, chatId, messageId, adminId, key) {
  const field = SETTING_FIELDS.find((f) => f.key === key);
  if (!field) return;
  const settings = await getSettings(env.BOT_KV);
  await setState(env, adminId, { step: "admin_set_field", key });
  await telegram.editOrSend(
    chatId,
    messageId,
    `${field.label}\n\nمقدار فعلی: ${settings[key]}\n\nمقدار جدید را ارسال کنید:`,
    { reply_markup: keyboard([], { back: "admin:settings" }) }
  );
}

export async function handleSettingValueInput(env, telegram, message, state) {
  const chatId = message.chat.id;
  const adminId = message.from.id;
  const field = SETTING_FIELDS.find((f) => f.key === state.key);
  const raw = (message.text || "").trim();
  await clearState(env, adminId);

  const settings = await getSettings(env.BOT_KV);
  settings[state.key] = field.numeric ? parseInt(raw.replace(/[^\d]/g, ""), 10) : raw;
  await saveSettings(env.BOT_KV, settings);
  await logAction(env.BOT_KV, adminId, "update_setting", { key: state.key, value: settings[state.key] });

  await telegram.sendMessage(chatId, "✅ تنظیمات بروزرسانی شد.", {
    reply_markup: keyboard([{ text: "📋 بازگشت", data: "admin:settings" }], { perRow: 1 }),
  });
}

export async function toggleGateway(env, telegram, chatId, messageId, adminId) {
  const settings = await getSettings(env.BOT_KV);
  settings.online_gateway_enabled = !settings.online_gateway_enabled;
  await saveSettings(env.BOT_KV, settings);
  await logAction(env.BOT_KV, adminId, "toggle_gateway", settings.online_gateway_enabled);
  await telegram.editOrSend(
    chatId,
    messageId,
    `وضعیت درگاه آنلاین: ${settings.online_gateway_enabled ? "🟢 فعال" : "🔴 غیرفعال"}`,
    { reply_markup: keyboard([{ text: "تغییر وضعیت", data: "admin:set:gateway" }], { perRow: 1, back: "admin:settings" }) }
  );
}

// ─────────────────────────────────────────────
// 🔌 روشن / خاموش کردن ربات
// ─────────────────────────────────────────────

export async function toggleBotPower(env, telegram, chatId, messageId, adminId) {
  const settings = await getSettings(env.BOT_KV);
  settings.bot_enabled = settings.bot_enabled === false ? true : false;
  await saveSettings(env.BOT_KV, settings);
  await logAction(env.BOT_KV, adminId, "toggle_bot_power", settings.bot_enabled);

  await telegram.editOrSend(
    chatId,
    messageId,
    `🔌 <b>وضعیت ربات</b>\n\n` +
      `وضعیت فعلی: ${settings.bot_enabled === false ? "🔴 خاموش" : "🟢 روشن"}\n\n` +
      `${settings.bot_enabled === false ? "کاربران عادی پیامی مبنی بر خاموش بودن ربات دریافت می‌کنند. ادمین‌ها همچنان به ربات دسترسی دارند." : "ربات برای همه کاربران فعال است."}`,
    { reply_markup: keyboard([{ text: "تغییر وضعیت", data: "admin:set:power" }], { perRow: 1, back: "admin:settings" }) }
  );
}

// ─────────────────────────────────────────────
// 🎨 رنگ دکمه‌ها
// ─────────────────────────────────────────────

const STYLE_LABELS = {
  default: "⚪ پیش‌فرض",
  primary: "🔵 آبی",
  success: "🟢 سبز",
  danger: "🔴 قرمز",
};

const STYLE_CODES = { n: "default", p: "primary", s: "success", d: "danger" };
const STYLE_CODE_BY_VALUE = { default: "n", primary: "p", success: "s", danger: "d" };

export async function showButtonStylesMenu(env, telegram, chatId, messageId) {
  const buttons = BUTTON_STYLE_CATEGORIES.map((cat, i) => ({
    text: `${cat.label} (${cat.items.length})`,
    data: `admin:style:cat:${i}`,
  }));

  await telegram.editOrSend(
    chatId,
    messageId,
    "🎨 <b>رنگ دکمه‌ها</b>\n\n" +
      "یک بخش را انتخاب کن تا رنگ دکمه‌های اون بخش رو تنظیم کنی.\n\n" +
      "⚠️ <b>نکته:</b> رنگ‌ها فقط تو Bot API 9.0+ و بعضی کلاینت‌ها (مثل نسخه‌های جدید تلگرام) نمایش داده می‌شن.",
    { reply_markup: keyboard(buttons, { perRow: 1, back: "admin:settings" }) }
  );
}

export async function showButtonStyleCategory(env, telegram, chatId, messageId, catIdx) {
  const cat = BUTTON_STYLE_CATEGORIES[catIdx];
  if (!cat) return;

  const settings = await getSettings(env.BOT_KV);
  const styles = settings.button_styles || {};

  const buttons = cat.items.map((item, i) => {
    const current = styles[item.key] || "default";
    return {
      text: `${item.label} — ${STYLE_LABELS[current] || current}`,
      data: `admin:style:item:${catIdx}:${i}`,
    };
  });

  await telegram.editOrSend(chatId, messageId, `🎨 <b>${cat.label}</b>`, {
    reply_markup: keyboard(buttons, { perRow: 1, back: "admin:set:styles" }),
  });
}

export async function showStylePicker(env, telegram, chatId, messageId, catIdx, itemIdx) {
  const cat = BUTTON_STYLE_CATEGORIES[catIdx];
  const item = cat && cat.items[itemIdx];
  if (!item) return;

  const settings = await getSettings(env.BOT_KV);
  const current = settings.button_styles?.[item.key] || "default";

  const buttons = [
    { text: `⚪ پیش‌فرض${current === "default" ? " ✅" : ""}`, data: `admin:style:set:${catIdx}:${itemIdx}:n` },
    { text: `🔵 آبی${current === "primary" ? " ✅" : ""}`, data: `admin:style:set:${catIdx}:${itemIdx}:p` },
    { text: `🟢 سبز${current === "success" ? " ✅" : ""}`, data: `admin:style:set:${catIdx}:${itemIdx}:s` },
    { text: `🔴 قرمز${current === "danger" ? " ✅" : ""}`, data: `admin:style:set:${catIdx}:${itemIdx}:d` },
  ];

  await telegram.editOrSend(
    chatId,
    messageId,
    `🎨 <b>رنگ دکمه: ${item.label}</b>\n\nرنگ فعلی: ${STYLE_LABELS[current] || current}\n\nرنگ جدید رو انتخاب کن:`,
    { reply_markup: keyboard(buttons, { perRow: 2, back: `admin:style:cat:${catIdx}` }) }
  );
}

export async function setButtonStyle(env, telegram, chatId, messageId, adminId, catIdx, itemIdx, code) {
  const cat = BUTTON_STYLE_CATEGORIES[catIdx];
  const item = cat && cat.items[itemIdx];
  const styleValue = STYLE_CODES[code];
  if (!item || !styleValue) return;

  const settings = await getSettings(env.BOT_KV);
  if (!settings.button_styles) settings.button_styles = {};
  settings.button_styles[item.key] = styleValue;
  await saveSettings(env.BOT_KV, settings);
  setCachedStyle(item.key, styleValue);

  await logAction(env.BOT_KV, adminId, "set_button_style", { key: item.key, value: styleValue });

  await showButtonStyleCategory(env, telegram, chatId, messageId, catIdx);
}

// ─────────────────────────────────────────────
// 📊 گروه لاگ
// ─────────────────────────────────────────────

export async function showLogGroupMenu(env, telegram, chatId, messageId) {
  const settings = await getSettings(env.BOT_KV);
  const status = settings.log_channel_id
    ? `🟢 فعال\n🆔 <code>${settings.log_channel_id}</code>\n📂 تعداد تاپیک: ${Object.keys(settings.log_topics || {}).length}`
    : "🔴 غیرفعال";

  const buttons = [
    { text: "🆔 تنظیم گروه (ورود دستی)", data: "admin:log:setup" },
    { text: "🔄 ساخت مجدد تاپیک‌ها", data: "admin:log:rebuild" },
    { text: "🗑 حذف تنظیمات", data: "admin:log:clear" },
  ];

  await telegram.editOrSend(
    chatId,
    messageId,
    `📊 <b>گروه لاگ</b>\n\nوضعیت: ${status}\n\n` +
      `📌 <b>راهنما:</b>\n` +
      `1. آیدی عددی گروه Forum رو کپی کن (با -100 شروع می‌شه)\n` +
      `2. دکمه «🆔 تنظیم گروه» رو بزن\n` +
      `3. آیدی رو بفرست`,
    { reply_markup: keyboard(buttons, { perRow: 1, back: "admin:settings" }) }
  );
}

export async function promptLogGroupSetup(env, telegram, chatId, messageId, adminId) {
  await setState(env, adminId, { step: "admin_log_forward" });
  await telegram.editOrSend(
    chatId,
    messageId,
    "📊 <b>تنظیم گروه لاگ</b>\n\n" +
      "آیدی عددی گروه Forum رو بفرست.\n" +
      "(باید با <code>-100</code> شروع بشه)\n\n" +
      "مثال: <code>-1003902163885</code>\n\n" +
      "⚠️ ربات باید تو گروه ادمین باشه با دسترسی <b>Manage Topics</b>.",
    { reply_markup: keyboard([], { back: "admin:set:log" }) }
  );
}

export async function handleLogGroupForward(env, telegram, message, state) {
  const chatId = message.chat.id;
  const adminId = message.from.id;
  await clearState(env, adminId);

  let logChatId = null;
  const rawText = (message.text || "").trim();

  if (/^-100\d+$/.test(rawText)) {
    logChatId = rawText;
  } else if (message.forward_from_chat) {
    logChatId = String(message.forward_from_chat.id);
  } else if (message.forward_origin?.type === "chat") {
    logChatId = String(message.forward_origin.sender_chat.id);
  }

  if (!logChatId) {
    await telegram.sendMessage(
      chatId,
      "❌ آیدی معتبر نیست.\n\n" +
        "باید یه آیدی عددی بفرستی که با <code>-100</code> شروع بشه.\n\n" +
        "مثال: <code>-1003902163885</code>",
      { reply_markup: keyboard([{ text: "📋 بازگشت", data: "admin:set:log" }], { perRow: 1 }) }
    );
    return;
  }

  await setLogChannel(env, logChatId);
  await telegram.sendMessage(chatId, "⏳ در حال ساخت تاپیک‌ها...");

  const topics = await setupLogTopics(env, telegram, logChatId);

  if (Object.keys(topics).length === 0) {
    await telegram.sendMessage(
      chatId,
      "❌ هیچ تاپیکی ساخته نشد.\n\nمطمئن شو:\n" +
        "• گروه <b>Forum</b> هست (Topics فعال)\n" +
        "• ربات <b>ادمین</b> هست\n" +
        "• ربات دسترسی <b>Manage Topics</b> داره\n" +
        "• آیدی درست وارد شده",
      { reply_markup: keyboard([{ text: "📋 بازگشت", data: "admin:set:log" }], { perRow: 1 }) }
    );
    return;
  }

  await setLogTopics(env, topics);
  await logAction(env.BOT_KV, adminId, "setup_log_group", { chat_id: logChatId, topics });

  const topicList = Object.keys(topics).map((k) => `✅ ${k}`).join("\n");

  await telegram.sendMessage(
    chatId,
    `✅ <b>گروه لاگ با موفقیت تنظیم شد</b>\n\n` +
      `🆔 <code>${logChatId}</code>\n` +
      `📂 تعداد تاپیک‌های ساخته شده: ${Object.keys(topics).length}\n\n` +
      `<b>تاپیک‌ها:</b>\n${topicList}`,
    { reply_markup: keyboard([{ text: "📋 بازگشت", data: "admin:set:log" }], { perRow: 1 }) }
  );
}

export async function rebuildLogTopics(env, telegram, chatId, messageId, adminId) {
  const settings = await getSettings(env.BOT_KV);
  if (!settings.log_channel_id) {
    await telegram.editOrSend(chatId, messageId, "❌ اول گروه لاگ رو تنظیم کن.", {
      reply_markup: keyboard([], { back: "admin:set:log" }),
    });
    return;
  }

  await telegram.editOrSend(chatId, messageId, "⏳ در حال ساخت مجدد تاپیک‌ها...");

  const topics = await setupLogTopics(env, telegram, settings.log_channel_id);
  await setLogTopics(env, topics);
  await logAction(env.BOT_KV, adminId, "rebuild_log_topics", topics);

  await telegram.editOrSend(
    chatId,
    messageId,
    `✅ ${Object.keys(topics).length} تاپیک ساخته شد.`,
    { reply_markup: keyboard([{ text: "📋 بازگشت", data: "admin:set:log" }], { perRow: 1 }) }
  );
}

export async function clearLogSettings(env, telegram, chatId, messageId, adminId) {
  const settings = await getSettings(env.BOT_KV);
  settings.log_channel_id = null;
  settings.log_topics = {};
  await saveSettings(env.BOT_KV, settings);
  await logAction(env.BOT_KV, adminId, "clear_log_settings", null);

  await telegram.editOrSend(chatId, messageId, "🗑 تنظیمات گروه لاگ حذف شد.", {
    reply_markup: keyboard([{ text: "📋 بازگشت", data: "admin:set:log" }], { perRow: 1 }),
  });
}

// ─────────────────────────────────────────────
// 📝 متن‌ها
// ─────────────────────────────────────────────

export async function showTextsMenu(env, telegram, chatId, messageId) {
  const buttons = TEXT_CATEGORIES.map((cat, i) => ({
    text: `${cat.label} (${cat.items.length})`,
    data: `admin:text:cat:${i}`,
  }));
  await telegram.editOrSend(chatId, messageId, "📝 <b>ویرایش متن‌های ربات</b>", {
    reply_markup: keyboard(buttons, { perRow: 1, back: "admin:settings" }),
  });
}

export async function showTextCategory(env, telegram, chatId, messageId, catIdx) {
  const cat = TEXT_CATEGORIES[catIdx];
  if (!cat) return;

  const buttons = cat.items.map((item, i) => ({ text: item.label, data: `admin:text:field:${catIdx}:${i}` }));
  await telegram.editOrSend(chatId, messageId, `📝 <b>${cat.label}</b>`, {
    reply_markup: keyboard(buttons, { perRow: 1, back: "admin:set:texts" }),
  });
}

export async function promptTextValue(env, telegram, chatId, messageId, adminId, catIdx, itemIdx) {
  const cat = TEXT_CATEGORIES[catIdx];
  const item = cat && cat.items[itemIdx];
  if (!item) return;

  const texts = await getTexts(env.BOT_KV);
  await setState(env, adminId, { step: "admin_set_text", key: item.key, cat: catIdx });
  await telegram.editOrSend(
    chatId,
    messageId,
    `${item.label}\n\nمتن فعلی:\n\n${texts[item.key]}\n\nمتن جدید را ارسال کنید:`,
    { reply_markup: keyboard([], { back: `admin:text:cat:${catIdx}` }) }
  );
}

export async function handleTextValueInput(env, telegram, message, state) {
  const chatId = message.chat.id;
  const adminId = message.from.id;
  const raw = message.text || "";
  await clearState(env, adminId);

  const texts = await getTexts(env.BOT_KV);
  texts[state.key] = raw;
  await saveTexts(env.BOT_KV, texts);
  await logAction(env.BOT_KV, adminId, "update_text", state.key);

  const backTarget = state.cat !== undefined ? `admin:text:cat:${state.cat}` : "admin:set:texts";
  await telegram.sendMessage(chatId, "✅ متن بروزرسانی شد.", {
    reply_markup: keyboard([{ text: "📋 بازگشت", data: backTarget }], { perRow: 1 }),
  });
}
