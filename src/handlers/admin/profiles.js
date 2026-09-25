import { keyboard } from "../../lib/keyboards.js";
import { setState, clearState } from "../../lib/state.js";
import { getPanelIndex, getPanel, getProfiles, saveProfiles, logAction } from "../../lib/kv.js";

const PROTOCOLS = ["VLESS Reality", "VMess WS", "Trojan", "Shadowsocks"];

export async function showProfilesMenu(env, telegram, chatId, messageId) {
  const ids = await getPanelIndex(env.BOT_KV);
  const panels = (await Promise.all(ids.map((id) => getPanel(env.BOT_KV, id)))).filter(Boolean);
  if (panels.length === 0) {
    await telegram.editOrSend(chatId, messageId, "ابتدا یک پنل اضافه کنید.", {
      reply_markup: keyboard([], { back: "admin:main" }),
    });
    return;
  }
  const buttons = panels.map((p) => ({ text: p.name, data: `admin:profiles:panel:${p.id}` }));
  await telegram.editOrSend(chatId, messageId, "پنل مورد نظر را انتخاب کنید:", {
    reply_markup: keyboard(buttons, { perRow: 1, back: "admin:main" }),
  });
}

export async function showPanelProfiles(env, telegram, chatId, messageId, panelId) {
  const profiles = await getProfiles(env.BOT_KV, panelId);
  const buttons = profiles.map((p) => ({
    text: `${p.active ? "🟢" : "🔴"} ${p.name}`,
    data: `admin:profile:view:${panelId}:${p.id}`,
  }));
  buttons.push({ text: "➕ افزودن پروفایل", data: `admin:profile:add:${panelId}` });

  await telegram.editOrSend(chatId, messageId, "👤 <b>پروفایل‌های این پنل</b>", {
    reply_markup: keyboard(buttons, { perRow: 1, back: "admin:panels" }),
  });
}

export async function startAddProfile(env, telegram, chatId, messageId, adminId, panelId) {
  const buttons = PROTOCOLS.map((p) => ({ text: p, data: `admin:profile:add:proto:${panelId}:${p}` }));
  await telegram.editOrSend(chatId, messageId, "🔌 نوع پروتکل پروفایل را انتخاب کنید:", {
    reply_markup: keyboard(buttons, { perRow: 1, back: `admin:profiles:panel:${panelId}` }),
  });
}

export async function addProfilePickProtocol(env, telegram, chatId, messageId, adminId, panelId, protocol) {
  await setState(env, adminId, { step: "admin_add_profile_name", data: { panel_id: panelId, protocol } });
  await telegram.editOrSend(
    chatId,
    messageId,
    "📝 نام نمایشی پروفایل را ارسال کنید:\n(مثال: آلمان - VLESS Reality)",
    { reply_markup: keyboard([], { back: `admin:profiles:panel:${panelId}` }) }
  );
}

export async function handleProfileTextInput(env, telegram, message, state) {
  const chatId = message.chat.id;
  const adminId = message.from.id;
  const name = (message.text || "").trim();
  const kv = env.BOT_KV;
  await clearState(env, adminId);

  const profiles = await getProfiles(kv, state.data.panel_id);
  const id = (profiles.reduce((m, p) => Math.max(m, p.id), 0) || 0) + 1;

  // `settings` / `inbound_tag` / `inbound_id` hold panel-specific routing info
  // (which inbound on Marzban, which inbound id on 3x-ui). Defaults are left
  // blank here since they depend on your panel's existing inbound config -
  // edit them directly in KV or extend this wizard if you need them sooner.
  profiles.push({
    id,
    name,
    protocol: state.data.protocol,
    active: true,
    inbound_tag: "",
    inbound_id: null,
    settings: {},
  });
  await saveProfiles(kv, state.data.panel_id, profiles);
  await logAction(kv, adminId, "add_profile", { panel_id: state.data.panel_id, id });

  await telegram.sendMessage(
    chatId,
    `✅ پروفایل «${name}» اضافه شد.\n\n⚠️ توجه: فیلد inbound_tag/inbound_id این پروفایل هنوز خالی است و باید طبق اینباند واقعی پنل شما تنظیم شود.`,
    { reply_markup: keyboard([{ text: "📋 بازگشت", data: `admin:profiles:panel:${state.data.panel_id}` }], { perRow: 1 }) }
  );
}

export async function toggleProfile(env, telegram, chatId, messageId, adminId, panelId, profileId) {
  const kv = env.BOT_KV;
  const profiles = await getProfiles(kv, panelId);
  const p = profiles.find((x) => x.id === profileId);
  if (!p) return;
  p.active = !p.active;
  await saveProfiles(kv, panelId, profiles);
  await logAction(kv, adminId, "toggle_profile", { panel_id: panelId, id: profileId, active: p.active });
  await showPanelProfiles(env, telegram, chatId, messageId, panelId);
}

export async function deleteProfile(env, telegram, chatId, messageId, adminId, panelId, profileId) {
  const kv = env.BOT_KV;
  const profiles = (await getProfiles(kv, panelId)).filter((x) => x.id !== profileId);
  await saveProfiles(kv, panelId, profiles);
  await logAction(kv, adminId, "delete_profile", { panel_id: panelId, id: profileId });
  await showPanelProfiles(env, telegram, chatId, messageId, panelId);
}

export async function showProfileDetail(env, telegram, chatId, messageId, panelId, profileId) {
  const profiles = await getProfiles(env.BOT_KV, panelId);
  const p = profiles.find((x) => x.id === profileId);
  if (!p) return;
  const buttons = [
    p.active ? { text: "🔴 غیرفعال", data: `admin:profile:toggle:${panelId}:${p.id}` } : { text: "🟢 فعال", data: `admin:profile:toggle:${panelId}:${p.id}` },
    { text: "🗑 حذف", data: `admin:profile:delete:${panelId}:${p.id}` },
  ];
  await telegram.editOrSend(chatId, messageId, `👤 ${p.name}\nپروتکل: ${p.protocol}`, {
    reply_markup: keyboard(buttons, { back: `admin:profiles:panel:${panelId}` }),
  });
}
