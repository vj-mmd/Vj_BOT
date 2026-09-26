import { keyboard } from "../lib/keyboards.js";
import { getUserServices, getService, getPanel, saveService } from "../lib/kv.js";
import { adapterFor } from "../lib/panels/index.js";

function statusLabel(service) {
  if (service.status === "disabled") return "⛔ غیرفعال";
  if (Date.now() > service.expires_at) return "🔴 منقضی شده";
  return "🟢 فعال";
}

export async function showServiceList(env, telegram, chatId, messageId, userId) {
  const services = await getUserServices(env.BOT_KV, userId);
  if (services.length === 0) {
    await telegram.editOrSend(chatId, messageId, "شما هنوز سرویسی ندارید.", {
      reply_markup: keyboard([{ text: "🛒 خرید اشتراک", data: "buy:categories" }], {
        perRow: 1,
        back: "menu:main",
      }),
    });
    return;
  }

  const buttons = services
    .filter(Boolean)
    .map((s) => ({ text: `🔍 ${s.id} - ${statusLabel(s)}`, data: `svc:view:${s.id}` }));

  await telegram.editOrSend(chatId, messageId, "🔍 <b>سرویس‌های من</b>", {
    reply_markup: keyboard(buttons, { perRow: 1, back: "menu:main" }),
  });
}

export async function showServiceDetail(env, telegram, chatId, messageId, serviceId) {
  const service = await getService(env.BOT_KV, serviceId);
  if (!service) {
    await telegram.editOrSend(chatId, messageId, "سرویس یافت نشد.", { reply_markup: keyboard([], { back: "svc:list" }) });
    return;
  }

  const text =
    `🔍 حجم کل: ${service.volume_gb}GB\n` +
    `📉 مصرف: ${(service.used_gb || 0).toFixed(2)}GB\n` +
    `📈 باقی‌مانده: ${Math.max(0, service.volume_gb - (service.used_gb || 0)).toFixed(2)}GB\n` +
    `⏳ انقضا: ${new Date(service.expires_at).toLocaleDateString("fa-IR")}\n` +
    `وضعیت: ${statusLabel(service)}`;

  const buttons = [
    { text: "🔗 Subscription", url: service.subscription_url },
    { text: "🔄 بروزرسانی اطلاعات", data: `svc:refresh:${service.id}` },
  ];

  await telegram.editOrSend(chatId, messageId, text, {
    reply_markup: keyboard(buttons, { back: "svc:list" }),
  });
}

export async function refreshService(env, telegram, chatId, messageId, serviceId) {
  const kv = env.BOT_KV;
  const service = await getService(kv, serviceId);
  if (!service) return;
  const panel = await getPanel(kv, service.panel_id);
  if (!panel) return;

  try {
    const adapter = adapterFor(panel);
    const remote = await adapter.getUser(panel, service.username);
    if (remote) {
      service.used_gb = remote.used_traffic_bytes / (1024 * 1024 * 1024);
      await saveService(kv, service);
    }
  } catch (e) {
    console.log("refresh service error", e);
  }

  await showServiceDetail(env, telegram, chatId, messageId, serviceId);
}
