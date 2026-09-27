import { keyboard } from "../lib/keyboards.js";
import { getUserServices, getService, getPanel, saveService, getUser, saveUser, addTransaction, getProduct } from "../lib/kv.js";
import { adapterFor } from "../lib/panels/index.js";
import { reportRenewal } from "../lib/report.js";
import { logRenewal } from "../lib/log.js";

function toman(n) {
  return `${n.toLocaleString("en-US")} تومان`;
}

function isExpired(service) {
  return Date.now() > service.expires_at;
}

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
    `⏳ انقضا: ${new Date(service.expires_at).toLocaleDateString("fa-IR")}` +
    (isExpired(service) ? "\n\n🔴 این سرویس منقضی شده است." : "");

  const buttons = [
    { text: "🔗 Subscription", url: service.subscription_url },
    { text: "🔄 بروزرسانی اطلاعات", data: `svc:refresh:${service.id}` },
  ];
  if (isExpired(service) && service.product_id) {
    buttons.push({ text: "♻️ تمدید اشتراک", data: `svc:renew:${service.id}` });
  }

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

// Shows the price and asks for confirmation before charging the wallet.
export async function promptRenew(env, telegram, chatId, messageId, userId, serviceId) {
  const kv = env.BOT_KV;
  const service = await getService(kv, serviceId);
  if (!service || service.user_id !== userId) return;

  const product = service.product_id ? await getProduct(kv, service.product_id) : null;
  if (!product) {
    await telegram.editOrSend(chatId, messageId, "❌ امکان تمدید خودکار این سرویس وجود ندارد. با پشتیبانی تماس بگیرید.", {
      reply_markup: keyboard([], { back: `svc:view:${serviceId}` }),
    });
    return;
  }

  const user = await getUser(kv, userId);
  const text =
    `♻️ <b>تمدید سرویس #${service.id}</b>\n\n` +
    `📦 ${product.name} — ${product.volume_gb}GB / ${product.duration_days} روز\n` +
    `💰 هزینه تمدید: ${toman(product.price)}\n` +
    `💼 موجودی کیف پول: ${toman(user.balance)}\n\n` +
    `با تمدید، زمان و حجم سرویس از نو (${product.volume_gb}GB / ${product.duration_days} روز) محاسبه می‌شود.`;

  if (user.balance < product.price) {
    await telegram.editOrSend(chatId, messageId, text + "\n\n❌ موجودی کیف پول کافی نیست.", {
      reply_markup: keyboard([{ text: "💳 شارژ کیف پول", data: "wallet:charge" }], {
        perRow: 1,
        back: `svc:view:${serviceId}`,
      }),
    });
    return;
  }

  await telegram.editOrSend(chatId, messageId, text, {
    reply_markup: {
      inline_keyboard: [
        [
          { text: "✅ تأیید و پرداخت", callback_data: `svc:renewconfirm:${serviceId}` },
          { text: "❌ انصراف", callback_data: `svc:view:${serviceId}` },
        ],
      ],
    },
  });
}

// Debits the wallet, resets time/volume on our side, and best-effort pushes
// the same reset to the underlying panel (if that adapter supports it).
export async function confirmRenew(env, telegram, chatId, messageId, userId, serviceId, callbackQueryId) {
  const kv = env.BOT_KV;
  const service = await getService(kv, serviceId);
  if (!service || service.user_id !== userId) return;

  const product = service.product_id ? await getProduct(kv, service.product_id) : null;
  if (!product) return;

  const user = await getUser(kv, userId);
  if (user.balance < product.price) {
    await telegram.answerCallbackQuery(callbackQueryId, "موجودی ناکافی است", true);
    return;
  }

  await addTransaction(kv, userId, {
    type: "renew",
    amount: -product.price,
    description: `تمدید سرویس #${service.id} — ${product.name}`,
  });

  service.expires_at = Date.now() + product.duration_days * 86400 * 1000;
  service.volume_gb = product.volume_gb;
  service.used_gb = 0;
  service.status = "active";
  await saveService(kv, service);

  const panel = await getPanel(kv, service.panel_id);
  if (panel) {
    try {
      const adapter = adapterFor(panel);
      if (adapter.renewUser) {
        await adapter.renewUser(panel, service.username, {
          volumeGB: product.volume_gb,
          days: product.duration_days,
        });
      } else if (adapter.disableUser) {
        // Adapter has no dedicated renew endpoint yet (e.g. 3x-ui) — the KV
        // record is renewed either way, but the panel-side quota/expiry
        // needs a manual check until that adapter gets a renewUser().
        console.log(`renewUser not implemented for panel type, service ${service.id} renewed in KV only`);
      }
    } catch (e) {
      console.log("renew on panel failed", e);
    }
  }

  await reportRenewal(env, telegram, user, product, product.price);

  // 📊 لاگ: تمدید
  try {
    await logRenewal(env, telegram, user, product, product.price);
  } catch (e) {
    console.log("logRenewal failed", e);
  }

  await telegram.answerCallbackQuery(callbackQueryId, "✅ سرویس تمدید شد");
  await showServiceDetail(env, telegram, chatId, messageId, serviceId);
}
