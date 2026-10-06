import { keyboard } from "../../lib/keyboards.js";
import { setState, clearState, getState } from "../../lib/state.js";
import { getUser, getProductIndex, getProduct, getPanel, getProfiles, createOrder, saveOrder, createService, getStats, saveStats, saveUser } from "../../lib/kv.js";
import { provisionUser } from "../../lib/panels/index.js";

export async function showManualSaleMenu(env, telegram, chatId, messageId) {
  await telegram.editOrSend(chatId, messageId,
    "🛍 <b>فروش دستی</b>\n\nآیدی عددی کاربر را ارسال کن؛ سپس محصول را انتخاب می‌کنی و سرویس مستقیم ساخته می‌شود.",
    { reply_markup: keyboard([{ text: "➕ شروع فروش دستی", data: "admin:manualsale:start" }], { perRow: 1, back: "admin:main" }) });
}
export async function promptUser(env, telegram, chatId, messageId, adminId) {
  await setState(env, adminId, { step: "admin_manual_sale_user" });
  await telegram.editOrSend(chatId, messageId, "👤 آیدی عددی کاربر را ارسال کن:", {
    reply_markup: keyboard([], { back: "admin:main" })
  });
}
export async function handleUser(env, telegram, message) {
  const adminId = message.from.id;
  const userId = parseInt((message.text || "").trim(), 10);
  const user = await getUser(env.BOT_KV, userId);
  if (!user) return telegram.sendMessage(message.chat.id, "❌ کاربر پیدا نشد.");
  await clearState(env, adminId);
  const ids = await getProductIndex(env.BOT_KV);
  const products = (await Promise.all(ids.map(id => getProduct(env.BOT_KV, id)))).filter(p => p && p.active);
  await setState(env, adminId, { step: "admin_manual_sale_product", target_id: userId });
  await telegram.sendMessage(message.chat.id, `👤 کاربر: <code>${userId}</code>\n\nمحصول را انتخاب کن:`, {
    reply_markup: keyboard(products.map(p => ({ text: `${p.name} — ${p.price.toLocaleString("en-US")} تومان`, data: `admin:manualsale:product:${p.id}` })), { perRow: 1, back: "admin:main" })
  });
}
export async function handleProduct(env, telegram, chatId, messageId, adminId, productId) {
  const state = await getState(env, adminId);
  const product = await getProduct(env.BOT_KV, productId);
  if (!state?.target_id || !product) return;
  await clearState(env, adminId);
  const user = await getUser(env.BOT_KV, state.target_id);
  const panel = await getPanel(env.BOT_KV, product.panel_id);
  const profiles = await getProfiles(env.BOT_KV, product.panel_id);
  const profile = profiles.find(p => p.id === product.profile_id);
  if (!panel || !profile) return telegram.editOrSend(chatId, messageId, "❌ پنل یا پروفایل محصول تنظیم نشده.", { reply_markup: keyboard([], { back: "admin:main" }) });
  try {
    const order = await createOrder(env.BOT_KV, { user_id: user.id, product_id: product.id, price: 0, payment_method: "manual", status: "processing", created_by: adminId });
    const result = await provisionUser(panel, profile, { username: `u${user.id}_${order.id}`, volumeGB: product.volume_gb, days: product.duration_days });
    const service = await createService(env.BOT_KV, {
      user_id: user.id, order_id: order.id, product_id: product.id, panel_id: panel.id,
      profile_id: profile.id, username: result.username, subscription_url: result.subscription_url,
      volume_gb: product.volume_gb, expires_at: Date.now() + product.duration_days * 86400000, status: "active"
    });
    order.status = "completed"; order.service_id = service.id; await saveOrder(env.BOT_KV, order);
    const stats = await getStats(env.BOT_KV); stats.total_orders += 1; await saveStats(env.BOT_KV, stats);
    await telegram.sendMessage(user.id, `🎉 <b>سرویس دستی شما آماده شد</b>\n\n👤 <code>${service.username}</code>\n📦 ${service.volume_gb}GB\n⏳ ${new Date(service.expires_at).toLocaleDateString("fa-IR")}\n🔗 ${service.subscription_url}`);
    await telegram.editOrSend(chatId, messageId, "✅ فروش دستی انجام شد و سرویس برای کاربر ارسال شد.", { reply_markup: keyboard([], { back: "admin:main" }) });
  } catch (e) {
    await telegram.editOrSend(chatId, messageId, `❌ ساخت سرویس ناموفق بود.\n<code>${String(e).slice(0,300)}</code>`, { reply_markup: keyboard([], { back: "admin:main" }) });
  }
}
