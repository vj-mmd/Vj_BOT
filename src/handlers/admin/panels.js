import { keyboard } from "../../lib/keyboards.js";
import { setState, clearState } from "../../lib/state.js";
import { getPanelIndex, getPanel, savePanel, deletePanel, logAction } from "../../lib/kv.js";
import { testConnection } from "../../lib/panels/index.js";

export async function showPanelsAdmin(env, telegram, chatId, messageId) {
  const ids = await getPanelIndex(env.BOT_KV);
  const panels = await Promise.all(ids.map((id) => getPanel(env.BOT_KV, id)));
  const buttons = panels
    .filter(Boolean)
    .map((p) => ({ text: `${p.active ? "🟢" : "🔴"} ${p.name} (${p.type})`, data: `admin:panel:view:${p.id}` }));
  buttons.push({ text: "➕ افزودن پنل", data: "admin:panel:add" });

  await telegram.editOrSend(chatId, messageId, "🖥 <b>مدیریت پنل‌ها</b>", {
    reply_markup: keyboard(buttons, { perRow: 1, back: "admin:main" }),
  });
}

export async function showPanelDetail(env, telegram, chatId, messageId, panelId) {
  const panel = await getPanel(env.BOT_KV, panelId);
  if (!panel) return;
  const text = `🖥 <b>${panel.name}</b>\n\nنوع: ${panel.type}\nURL: ${panel.url}`;
  const buttons = [
    { text: "🔌 تست اتصال", data: `admin:panel:test:${panel.id}` },
    panel.active ? { text: "🔴 غیرفعال", data: `admin:panel:toggle:${panel.id}` } : { text: "🟢 فعال", data: `admin:panel:toggle:${panel.id}` },
    { text: "👤 پروفایل‌های این پنل", data: `admin:profiles:panel:${panel.id}` },
    { text: "🗑 حذف", data: `admin:panel:delete:${panel.id}` },
  ];
  await telegram.editOrSend(chatId, messageId, text, { reply_markup: keyboard(buttons, { back: "admin:panels" }) });
}

export async function startAddPanel(env, telegram, chatId, messageId, adminId) {
  const buttons = [
    { text: "Marzban", data: "admin:panel:add:type:marzban" },
    { text: "3x-ui / Sanaei", data: "admin:panel:add:type:threexui" },
    { text: "Pasargad (PasarGuard)", data: "admin:panel:add:type:pasarguard" },
  ];
  await telegram.editOrSend(chatId, messageId, "نوع پنل را انتخاب کنید:", {
    reply_markup: keyboard(buttons, { perRow: 1, back: "admin:panels" }),
  });
}

const PANEL_FIELDS = [
  { step: "admin_add_panel_name", field: "name", next: "admin_add_panel_url", prompt: "🌐 آدرس URL پنل را ارسال کنید (بدون / انتهایی):" },
  { step: "admin_add_panel_url", field: "url", next: "admin_add_panel_user", prompt: "👤 نام کاربری ادمین پنل را ارسال کنید:" },
  { step: "admin_add_panel_user", field: "username", next: "admin_add_panel_pass", prompt: "🔑 رمز عبور ادمین پنل را ارسال کنید:" },
  { step: "admin_add_panel_pass", field: "password", next: null, prompt: null },
];

export async function addPanelPickType(env, telegram, chatId, messageId, adminId, type) {
  await setState(env, adminId, { step: "admin_add_panel_name", data: { type } });
  await telegram.editOrSend(chatId, messageId, "📝 نام دلخواه برای این پنل را ارسال کنید:", {
    reply_markup: keyboard([], { back: "admin:panels" }),
  });
}

export async function handlePanelTextInput(env, telegram, message, state) {
  const chatId = message.chat.id;
  const adminId = message.from.id;
  const raw = (message.text || "").trim();
  const current = PANEL_FIELDS.find((f) => f.step === state.step);
  if (!current) return;

  const data = { ...state.data, [current.field]: raw };

  if (current.next) {
    await setState(env, adminId, { step: current.next, data });
    await telegram.sendMessage(chatId, current.prompt);
    return;
  }

  await clearState(env, adminId);
  const panel = await savePanel(env.BOT_KV, { ...data, active: true });
  await logAction(env.BOT_KV, adminId, "add_panel", panel.id);

  await telegram.sendMessage(chatId, "⏳ در حال تست اتصال...");
  const result = await testConnection(panel);
  await telegram.sendMessage(
    chatId,
    result.ok ? "✅ پنل اضافه شد و اتصال موفق بود." : `⚠️ پنل اضافه شد اما تست اتصال ناموفق بود: ${result.error}`,
    { reply_markup: keyboard([{ text: "📋 بازگشت", data: "admin:panels" }], { perRow: 1 }) }
  );
}

export async function togglePanel(env, telegram, chatId, messageId, adminId, panelId) {
  const panel = await getPanel(env.BOT_KV, panelId);
  if (!panel) return;
  panel.active = !panel.active;
  await savePanel(env.BOT_KV, panel);
  await logAction(env.BOT_KV, adminId, "toggle_panel", { id: panelId, active: panel.active });
  await showPanelDetail(env, telegram, chatId, messageId, panelId);
}

export async function removePanel(env, telegram, chatId, messageId, adminId, panelId) {
  await deletePanel(env.BOT_KV, panelId);
  await logAction(env.BOT_KV, adminId, "delete_panel", panelId);
  await showPanelsAdmin(env, telegram, chatId, messageId);
}

export async function runPanelTest(env, telegram, chatId, panelId, callbackQueryId) {
  const panel = await getPanel(env.BOT_KV, panelId);
  if (!panel) return;
  await telegram.answerCallbackQuery(callbackQueryId, "در حال تست...");
  const result = await testConnection(panel);
  await telegram.sendMessage(chatId, result.ok ? "✅ اتصال موفق بود." : `❌ اتصال ناموفق: ${result.error}`);
}
