import { keyboard } from "../../lib/keyboards.js";
import { setState, clearState } from "../../lib/state.js";
import { getSettings, saveSettings, getTexts, saveTexts, logAction } from "../../lib/kv.js";

const SETTING_FIELDS = [
  { key: "min_charge", label: "💰 حداقل شارژ", numeric: true },
  { key: "ref_reward_percent", label: "🎁 پاداش دعوت (%)", numeric: true },
  { key: "test_count", label: "🎁 تعداد تست", numeric: true },
  { key: "test_volume_gb", label: "📦 حجم تست (GB)", numeric: true },
  { key: "test_duration_days", label: "⏳ مدت تست (روز)", numeric: true },
  { key: "card_number", label: "💳 شماره کارت", numeric: false },
  { key: "card_holder", label: "👤 نام صاحب کارت", numeric: false },
  { key: "support_id", label: "👨‍💻 آیدی پشتیبانی", numeric: false },
];

export async function showSettingsMenu(env, telegram, chatId, messageId) {
  const buttons = SETTING_FIELDS.map((f) => ({ text: f.label, data: `admin:set:field:${f.key}` }));
  buttons.push({ text: "🌐 وضعیت درگاه آنلاین", data: "admin:set:gateway" });
  buttons.push({ text: "📝 متن‌های ربات", data: "admin:set:texts" });

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

const TEXT_KEYS = [
  { key: "welcome", label: "🎃 پیام خوش‌آمدگویی" },
  { key: "join_required", label: "📢 متن عضویت اجباری" },
  { key: "support_menu", label: "💬 متن پشتیبانی" },
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
