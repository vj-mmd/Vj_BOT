import { keyboard } from "../../lib/keyboards.js";
import { setState, clearState } from "../../lib/state.js";
import { getSettings, saveSettings, getTexts, saveTexts, logAction } from "../../lib/kv.js";
import { setupLogTopics, setLogChannel, setLogTopics } from "../../lib/log.js";

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
  const buttons = SETTING_FIELDS.map((f) => ({ text: f.label, data: `admin:set:field:${f.key}` }));
  buttons.push({ text: "🌐 وضعیت درگاه آنلاین", data: "admin:set:gateway" });
  buttons.push({ text: "🎨 رنگ دکمه‌ها", data: "admin:set:styles" });
  buttons.push({ text: "📝 متن‌های ربات", data: "admin:set:texts" });
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
// 🎨 رنگ دکمه‌ها
// ─────────────────────────────────────────────

const BUTTON_STYLE_ITEMS = [
  { key: "menu:test",      label: "🦠 اکانت تست" },
  { key: "menu:buy",       label: "💥 خرید اشتراک" },
  { key: "menu:invite",    label: "🗣 دعوت دوستان" },
  { key: "menu:wallet",    label: "💸 کیف پول" },
  { key: "menu:services",  label: "🔍 سرویس‌های من" },
  { key: "menu:support",   label: "☎️ پشتیبانی" },
  { key: "confirm:yes",    label: "✅ دکمه تأیید (بله)" },
  { key: "confirm:no",     label: "❌ دکمه لغو (خیر)" },
  { key: "back",           label: "⬅️ دکمه بازگشت" },
];

const STYLE_LABELS = {
  default: "⚪ پیش‌فرض",
  primary: "🔵 آبی",
  success: "🟢 سبز",
  danger: "🔴 قرمز",
};

export async function showButtonStylesMenu(env, telegram, chatId, messageId) {
  const settings = await getSettings(env.BOT_KV);
  const styles = settings.button_styles || {};

  const buttons = BUTTON_STYLE_ITEMS.map((item) => {
    const current = styles[item.key] || "default";
    return {
      text: `${item.label} — ${STYLE_LABELS[current] || current}`,
      data: `admin:style:item:${item.key}`,
    };
  });

  await telegram.editOrSend(
    chatId,
    messageId,
    "🎨 <b>رنگ دکمه‌ها</b>\n\n" +
      "برای هر دکمه، رنگ مورد نظر رو انتخاب کن.\n\n" +
      "⚠️ <b>نکته:</b> رنگ‌ها فقط تو Bot API 9.0+ و بعضی کلاینت‌ها (مثل نسخه‌های جدید تلگرام) نمایش داده می‌شن.",
    { reply_markup: keyboard(buttons, { perRow: 1, back: "admin:settings" }) }
  );
}

export async function showStylePicker(env, telegram, chatId, messageId, styleKey) {
  const item = BUTTON_STYLE_ITEMS.find((i) => i.key === styleKey);
  if (!item) return;

  const settings = await getSettings(env.BOT_KV);
  const current = settings.button_styles?.[styleKey] || "default";

  const buttons = [
    { text: `⚪ پیش‌فرض${current === "default" ? " ✅" : ""}`, data: `admin:style:set:${styleKey}:default` },
    { text: `🔵 آبی${current === "primary" ? " ✅" : ""}`, data: `admin:style:set:${styleKey}:primary` },
    { text: `🟢 سبز${current === "success" ? " ✅" : ""}`, data: `admin:style:set:${styleKey}:success` },
    { text: `🔴 قرمز${current === "danger" ? " ✅" : ""}`, data: `admin:style:set:${styleKey}:danger` },
  ];

  await telegram.editOrSend(
    chatId,
    messageId,
    `🎨 <b>رنگ دکمه: ${item.label}</b>\n\nرنگ فعلی: ${STYLE_LABELS[current] || current}\n\nرنگ جدید رو انتخاب کن:`,
    { reply_markup: keyboard(buttons, { perRow: 2, back: "admin:set:styles" }) }
  );
}

export async function setButtonStyle(env, telegram, chatId, messageId, adminId, styleKey, styleValue) {
  if (!["default", "primary", "success", "danger"].includes(styleValue)) return;

  const settings = await getSettings(env.BOT_KV);
  if (!settings.button_styles) settings.button_styles = {};
  settings.button_styles[styleKey] = styleValue;
  await saveSettings(env.BOT_KV, settings);

  await logAction(env.BOT_KV, adminId, "set_button_style", { key: styleKey, value: styleValue });

  // برگشت به منوی رنگ‌ها
  await showButtonStylesMenu(env, telegram, chatId, messageId);
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

const TEXT_KEYS = [
  { key: "welcome", label: "🎃 پیام خوش‌آمدگویی" },
  { key: "join_required", label: "📢 متن عضویت اجباری" },
  { key: "support_menu", label: "💬 متن پشتیبانی" },
  { key: "rules", label: "📜 متن قوانین" },
  { key: "phone_request", label: "📱 متن درخواست شماره تلفن" },
  { key: "phone_verified", label: "✅ متن تأیید شماره تلفن" },
];

export async function showTextsMenu(env, telegram, chatId, messageId) {
  const buttons = TEXT_KEYS.map((t) => ({ text: t.label, data: `admin:text:field:${t.key}` }));
  await telegram.editOrSend(chatId, messageId, "📝 <b>ویرایش متن‌های ربات</b>", {
    reply_markup: keyboard(buttons, { perRow: 1, back: "admin:settings" }),
  });
}

export async function promptTextValue(env, telegram, chatId, messageId, adminId, key) {
  const texts = await getTexts(env.BOT_KV);
  await setState(env, adminId, { step: "admin_set_text", key });
  await telegram.editOrSend(chatId, messageId, `متن فعلی:\n\n${texts[key]}\n\nمتن جدید را ارسال کنید:`, {
    reply_markup: keyboard([], { back: "admin:set:texts" }),
  });
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

  await telegram.sendMessage(chatId, "✅ متن بروزرسانی شد.", {
    reply_markup: keyboard([{ text: "📋 بازگشت", data: "admin:set:texts" }], { perRow: 1 }),
  });
}
