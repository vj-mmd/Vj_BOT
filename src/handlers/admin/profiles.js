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

const toLatinDigits = (s) =>
  String(s || "")
    .replace(/[۰-۹]/g, (d) => "۰۱۲۳۴۵۶۷۸۹".indexOf(d))
    .replace(/[٠-٩]/g, (d) => "٠١٢٣٤٥٦٧٨٩".indexOf(d));

// Marzban / PasarGuard need the lowercase protocol key (vless, vmess, ...);
// 3x-ui only uses the label for display.
function normalizeProtocol(panelType, label) {
  if (panelType === "threexui") return label;
  const l = String(label || "").toLowerCase();
  if (l.includes("vless")) return "vless";
  if (l.includes("vmess")) return "vmess";
  if (l.includes("trojan")) return "trojan";
  if (l.includes("shadowsocks")) return "shadowsocks";
  return l;
}

function inboundPrompt(panelType) {
  return panelType === "threexui"
    ? "🔢 <b>شماره (ID) اینباند</b> را ارسال کنید.\n\nدر پنل 3x-ui: بخش Inbounds ← ستون ID (مثلاً 1)"
    : "🏷 <b>تگ (tag) اینباند</b> را دقیقاً مطابق پنل ارسال کنید.\n\nدر پنل: Core Settings ← بخش inbounds ← فیلد tag\n(مثال: VLESS TCP REALITY)";
}

export async function handleProfileTextInput(env, telegram, message, state) {
  const chatId = message.chat.id;
  const adminId = message.from.id;
  const name = (message.text || "").trim();
  if (!name) {
    await telegram.sendMessage(chatId, "❌ نام نامعتبر است. دوباره ارسال کنید:");
    return;
  }
  const panel = await getPanel(env.BOT_KV, state.data.panel_id);
  await setState(env, adminId, { step: "admin_profile_inbound", data: { ...state.data, name } });
  await telegram.sendMessage(chatId, inboundPrompt(panel?.type), {
    reply_markup: keyboard([], { back: `admin:profiles:panel:${state.data.panel_id}` }),
  });
}

export async function startSetInbound(env, telegram, chatId, messageId, adminId, panelId, profileId) {
  const panel = await getPanel(env.BOT_KV, panelId);
  const profiles = await getProfiles(env.BOT_KV, panelId);
  const p = profiles.find((x) => x.id === profileId);
  if (!panel || !p) return;
  await setState(env, adminId, { step: "admin_profile_inbound", data: { panel_id: panelId, profile_id: profileId } });
  await telegram.editOrSend(chatId, messageId, inboundPrompt(panel.type), {
    reply_markup: keyboard([], { back: `admin:profile:view:${panelId}:${profileId}` }),
  });
}

export async function handleProfileInboundInput(env, telegram, message, state) {
  const chatId = message.chat.id;
  const adminId = message.from.id;
  const kv = env.BOT_KV;
  const raw = (message.text || "").trim();
  const panelId = state.data.panel_id;
  const panel = await getPanel(kv, panelId);
  if (!panel) {
    await clearState(env, adminId);
    return telegram.sendMessage(chatId, "❌ پنل پیدا نشد.");
  }

  let inbound_id = null;
  let inbound_tag = "";
  if (panel.type === "threexui") {
    const n = parseInt(toLatinDigits(raw).replace(/[^\d]/g, ""), 10);
    if (Number.isNaN(n)) {
      await telegram.sendMessage(chatId, "❌ فقط عدد ID اینباند را ارسال کنید (مثلاً 1):");
      return;
    }
    inbound_id = n;
  } else {
    if (!raw) {
      await telegram.sendMessage(chatId, "❌ تگ اینباند نمی‌تواند خالی باشد. دوباره ارسال کنید:");
      return;
    }
    inbound_tag = raw;
  }

  await clearState(env, adminId);
  const profiles = await getProfiles(kv, panelId);
  let profile;

  if (state.data.profile_id) {
    profile = profiles.find((x) => x.id === state.data.profile_id);
    if (!profile) return telegram.sendMessage(chatId, "❌ پروفایل پیدا نشد.");
    const wasReality = /reality/i.test(`${profile.protocol} ${profile.name}`);
    profile.protocol = normalizeProtocol(panel.type, profile.protocol);
    profile.inbound_id = inbound_id;
    profile.inbound_tag = inbound_tag;
    if (panel.type !== "threexui" && profile.protocol === "vless" && !(profile.settings && profile.settings.flow) && wasReality) {
      profile.settings = { ...(profile.settings || {}), flow: "xtls-rprx-vision" };
    }
  } else {
    const id = (profiles.reduce((m, p) => Math.max(m, p.id), 0) || 0) + 1;
    const isReality = /reality/i.test(state.data.protocol || "");
    const protocol = normalizeProtocol(panel.type, state.data.protocol);
    profile = {
      id,
      name: state.data.name,
      protocol,
      active: true,
      inbound_tag,
      inbound_id,
      settings: panel.type !== "threexui" && protocol === "vless" && isReality ? { flow: "xtls-rprx-vision" } : {},
    };
    profiles.push(profile);
  }

  await saveProfiles(kv, panelId, profiles);
  await logAction(kv, adminId, state.data.profile_id ? "set_profile_inbound" : "add_profile", { panel_id: panelId, id: profile.id });

  const shown = panel.type === "threexui" ? `ID اینباند: ${inbound_id}` : `تگ اینباند: ${inbound_tag}`;
  await telegram.sendMessage(chatId, `✅ پروفایل «${profile.name}» ذخیره شد.\n${shown}`, {
    reply_markup: keyboard([{ text: "📋 بازگشت", data: `admin:profiles:panel:${panelId}` }], { perRow: 1 }),
  });
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
  const panel = await getPanel(env.BOT_KV, panelId);
  const inboundLine = panel?.type === "threexui"
    ? `\nID اینباند: ${p.inbound_id ?? "❗️تنظیم نشده"}`
    : `\nتگ اینباند: ${p.inbound_tag || "❗️تنظیم نشده"}`;
  const buttons = [
    { text: "🔧 تنظیم اینباند", data: `admin:profile:inbound:${panelId}:${p.id}` },
    p.active ? { text: "🔴 غیرفعال", data: `admin:profile:toggle:${panelId}:${p.id}` } : { text: "🟢 فعال", data: `admin:profile:toggle:${panelId}:${p.id}` },
    { text: "🗑 حذف", data: `admin:profile:delete:${panelId}:${p.id}` },
  ];
  await telegram.editOrSend(chatId, messageId, `👤 ${p.name}\nپروتکل: ${p.protocol}${inboundLine}`, {
    reply_markup: keyboard(buttons, { back: `admin:profiles:panel:${panelId}` }),
  });
}
