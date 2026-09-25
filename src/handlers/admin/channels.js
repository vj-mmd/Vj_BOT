import { keyboard } from "../../lib/keyboards.js";
import { setState, clearState } from "../../lib/state.js";
import { getChannels, saveChannels, logAction } from "../../lib/kv.js";

export async function showChannelsAdmin(env, telegram, chatId, messageId) {
  const channels = await getChannels(env.BOT_KV);
  const buttons = channels.map((c) => ({ text: `${c.active ? "🟢" : "🔴"} ${c.name}`, data: `admin:chan:view:${c.id}` }));
  buttons.push({ text: "➕ افزودن کانال", data: "admin:chan:add" });

  await telegram.editOrSend(chatId, messageId, "📢 <b>کانال‌های عضویت اجباری</b>", {
    reply_markup: keyboard(buttons, { perRow: 1, back: "admin:main" }),
  });
}

export async function showChannelDetail(env, telegram, chatId, messageId, channelId) {
  const channels = await getChannels(env.BOT_KV);
  const c = channels.find((x) => x.id === channelId);
  if (!c) return;
  const buttons = [
    c.active ? { text: "🔴 غیرفعال", data: `admin:chan:toggle:${c.id}` } : { text: "🟢 فعال", data: `admin:chan:toggle:${c.id}` },
    { text: "🗑 حذف", data: `admin:chan:delete:${c.id}` },
  ];
  await telegram.editOrSend(chatId, messageId, `📢 ${c.name}\nChat ID: <code>${c.chat_id}</code>`, {
    reply_markup: keyboard(buttons, { back: "admin:channels" }),
  });
}

// Wizard: name -> chat_id -> invite_url
const FIELDS = [
  { step: "admin_add_chan_name", field: "name", next: "admin_add_chan_id", prompt: "🆔 Chat ID کانال را ارسال کنید (مثال: -1001234567890):" },
  { step: "admin_add_chan_id", field: "chat_id", next: "admin_add_chan_url", prompt: "🔗 لینک عضویت کانال را ارسال کنید:" },
  { step: "admin_add_chan_url", field: "invite_url", next: null, prompt: null },
];

export async function startAddChannel(env, telegram, chatId, messageId, adminId) {
  await setState(env, adminId, { step: "admin_add_chan_name", data: {} });
  await telegram.editOrSend(chatId, messageId, "📝 نام نمایشی کانال را ارسال کنید:", {
    reply_markup: keyboard([], { back: "admin:channels" }),
  });
}

export async function handleChannelTextInput(env, telegram, message, state) {
  const chatId = message.chat.id;
  const adminId = message.from.id;
  const raw = (message.text || "").trim();
  const current = FIELDS.find((f) => f.step === state.step);
  if (!current) return;

  const data = { ...state.data, [current.field]: raw };

  if (current.next) {
    await setState(env, adminId, { step: current.next, data });
    await telegram.sendMessage(chatId, current.prompt);
    return;
  }

  await clearState(env, adminId);
  const channels = await getChannels(env.BOT_KV);
  const id = (channels.reduce((m, c) => Math.max(m, c.id), 0) || 0) + 1;
  channels.push({ id, ...data, active: true });
  await saveChannels(env.BOT_KV, channels);
  await logAction(env.BOT_KV, adminId, "add_channel", data.name);

  await telegram.sendMessage(
    chatId,
    "✅ کانال اضافه شد.\n⚠️ توجه: ربات باید ادمین همان کانال باشد تا بتواند عضویت را بررسی کند.",
    { reply_markup: keyboard([{ text: "📋 بازگشت", data: "admin:channels" }], { perRow: 1 }) }
  );
}

export async function toggleChannel(env, telegram, chatId, messageId, adminId, channelId) {
  const channels = await getChannels(env.BOT_KV);
  const c = channels.find((x) => x.id === channelId);
  if (!c) return;
  c.active = !c.active;
  await saveChannels(env.BOT_KV, channels);
  await logAction(env.BOT_KV, adminId, "toggle_channel", channelId);
  await showChannelDetail(env, telegram, chatId, messageId, channelId);
}

export async function removeChannel(env, telegram, chatId, messageId, adminId, channelId) {
  const channels = (await getChannels(env.BOT_KV)).filter((c) => c.id !== channelId);
  await saveChannels(env.BOT_KV, channels);
  await logAction(env.BOT_KV, adminId, "delete_channel", channelId);
  await showChannelsAdmin(env, telegram, chatId, messageId);
}
