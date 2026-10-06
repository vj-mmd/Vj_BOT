import { keyboard } from "../lib/keyboards.js";
import { getUserServices, getService, getPanel, saveService, getUser, addTransaction, addTransactionSafe, getProduct, getTexts, getProfiles, getSettings } from "../lib/kv.js";
import { adapterFor } from "../lib/panels/index.js";
import { withUserLock } from "../lib/locks.js";
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
  const texts = await getTexts(env.BOT_KV);
  if (services.length === 0) {
    await telegram.editOrSend(chatId, messageId, texts.services_empty, {
      reply_markup: keyboard([{ text: "🛒 خرید اشتراک", data: "buy:categories" }], {
        perRow: 1,
        back: "menu:main",
      }),
    });
    return;
  }

  const buttons = services
    .filter(Boolean)
    .map((s) => ({ text: `${statusLabel(s).split(" ")[0]} ${s.username || "سرویس"} • #${s.id}`, data: `svc:view:${s.id}` }));

  await telegram.editOrSend(chatId, messageId, `🔍 <b>سرویس‌های من</b>\n\nتعداد: ${buttons.length}\nبرای مشاهده جزئیات، یکی از سرویس‌ها را انتخاب کنید:`, {
    reply_markup: keyboard(buttons, { perRow: 1, back: "menu:main" }),
  });
}

export async function showServiceDetail(env, telegram, chatId, messageId, serviceId) {
  const service = await getService(env.BOT_KV, serviceId);
  const texts = await getTexts(env.BOT_KV);
  if (!service) {
    await telegram.editOrSend(chatId, messageId, texts.services_not_found, { reply_markup: keyboard([], { back: "svc:list" }) });
    return;
  }

  const settings = await getSettings(env.BOT_KV);
  const used = Math.max(0, Number(service.used_gb || 0));
  const total = Math.max(0, Number(service.volume_gb || 0));
  const remaining = Math.max(0, total - used);
  const daysLeft = Math.max(0, Math.ceil((Number(service.expires_at || 0) - Date.now()) / 86400000));
  const percent = total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0;
  const bar = (() => { const n = Math.round(percent / 10); return "▰".repeat(n) + "▱".repeat(10 - n); })();
  const text =
    `🧾 <b>اطلاعات سرویس</b>\n\n\n` +
    `📌 <b>وضعیت:</b> ${statusLabel(service)}\n` +
    `👤 <b>نام سرویس:</b> <code>${service.username || "—"}</code>\n\n` +
    `📦 <b>حجم کل:</b> ${total.toFixed(2)} گیگابایت\n` +
    `📉 <b>مصرف‌شده:</b> ${used.toFixed(2)} گیگابایت (${percent}٪)\n` +
    `📈 <b>باقی‌مانده:</b> ${remaining.toFixed(2)} گیگابایت\n` +
    `${bar}\n\n` +
    `⏳ <b>تاریخ انقضا:</b> ${new Date(service.expires_at).toLocaleDateString("fa-IR")}\n` +
    `🗓 <b>روز باقی‌مانده:</b> ${isExpired(service) ? "۰ (منقضی شده)" : daysLeft + " روز"}\n\n` +
    `🔗 <b>لینک ساب:</b>\n${service.subscription_url ? `<code>${service.subscription_url}</code>` : "ثبت نشده"}` +
    (isExpired(service) ? `\n\n${texts.services_expired_note}` : "");

  const buttons = [
    { text: "🔄 بررسی و بروزرسانی اطلاعات", data: `svc:refresh:${service.id}` },
  ];
  if (service.product_id && service.status !== "disabled" && settings.features?.renewal !== false) buttons.push({ text: "♻️ تمدید سرویس", data: `svc:renew:${service.id}` });
  if (service.status !== "disabled" && settings.features?.extra_volume !== false) buttons.push({ text: "➕ افزایش حجم", data: `svc:addvol:${service.id}:1` });
  if (service.status !== "disabled" && settings.features?.extra_days !== false) buttons.push({ text: "⏳ افزایش مدت", data: `svc:adddays:${service.id}:1` });
  if (service.status !== "disabled") buttons.push({ text: "🗑 حذف سرویس", data: `svc:deleteconfirm:${service.id}` });
  if (service.panel_id && service.status !== "disabled") buttons.push({ text: "🔐 ساخت دوباره لینک ساب", data: `svc:revoke:${service.id}` });

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
    const profile = service.profile_id ? (await getProfiles(kv, panel.id)).find(p => p.id === service.profile_id) : null;
    const remote = panel.type === "threexui" ? await adapter.getUser(panel, profile?.inbound_id, service.username) : await adapter.getUser(panel, service.username);
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
  const kv = env.BOT_KV; const settings = await getSettings(kv); if (settings.features?.renewal === false) return;

  const service = await getService(kv, serviceId);
  if (!service || service.user_id !== userId) return;

  const texts = await getTexts(kv);
  const product = service.product_id ? await getProduct(kv, service.product_id) : null;
  if (!product) {
    await telegram.editOrSend(chatId, messageId, texts.services_renew_unavailable, {
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
    `با تمدید، ${product.duration_days} روز به پایان سرویس اضافه می‌شود و حجم سرویس روی ${product.volume_gb}GB تنظیم می‌شود.`;

  if (user.balance < product.price) {
    await telegram.editOrSend(chatId, messageId, text + "\n\n" + texts.buy_insufficient_balance, {
      reply_markup: keyboard([{ text: "💳 شارژ کیف پول", data: "wallet:charge" }], {
        perRow: 1,
        back: `svc:view:${serviceId}`,
      }),
    });
    return;
  }

  await telegram.editOrSend(chatId, messageId, text, {
    reply_markup: keyboard(
      [
        { text: "✅ تأیید و پرداخت", data: `svc:renewconfirm:${serviceId}` },
        { text: "❌ انصراف", data: `svc:view:${serviceId}` },
      ],
      { perRow: 2 }
    ),
  });
}

// Debits the wallet, resets time/volume on our side, and best-effort pushes
// the same reset to the underlying panel (if that adapter supports it).
export async function confirmRenew(env, telegram, chatId, messageId, userId, serviceId, callbackQueryId) {
  const kv=env.BOT_KV;
  try {
    await withUserLock(env,userId,async()=>{
      const service=await getService(kv,serviceId); if(!service||service.user_id!==userId)throw Error("NOT_FOUND");
      const product=service.product_id?await getProduct(kv,service.product_id):null;if(!product)throw Error("NO_PRODUCT");
      const user=await getUser(kv,userId);if(user.balance<product.price)throw Error("INSUFFICIENT");
      await addTransaction(kv,userId,{type:"renew",amount:-product.price,description:`تمدید سرویس #${service.id} — ${product.name}`});
      const oldExpiry=Number(service.expires_at||0); service.expires_at=Math.max(Date.now(),oldExpiry)+product.duration_days*86400000;service.volume_gb=product.volume_gb;service.used_gb=0;service.status="active";await saveService(kv,service);
      const panel=await getPanel(kv,service.panel_id);if(panel){const adapter=adapterFor(panel);try{const profile=service.profile_id?(await getProfiles(kv,panel.id)).find(p=>p.id===service.profile_id):null;if(adapter.renewUser){if(panel.type==="threexui")await adapter.renewUser(panel,profile,service.username,{volumeGB:product.volume_gb,days:product.duration_days,currentExpiry:oldExpiry});else await adapter.renewUser(panel,service.username,{volumeGB:product.volume_gb,days:product.duration_days,currentExpiry:oldExpiry});}}catch(e){console.log("renew panel failed",e);}}
      await reportRenewal(env,telegram,user,product,product.price);try{await logRenewal(env,telegram,user,product,product.price)}catch{}
    });
    await telegram.answerCallbackQuery(callbackQueryId,"✅ سرویس تمدید شد");return showServiceDetail(env,telegram,chatId,messageId,serviceId);
  } catch(e) {
    if(e.message==="INSUFFICIENT")return telegram.answerCallbackQuery(callbackQueryId,"❌ موجودی کافی نیست",true);
    if(e.message==="NOT_FOUND")return;
    await telegram.answerCallbackQuery(callbackQueryId,"❌ تمدید انجام نشد",true);
  }
}

async function addOn(env, telegram, chatId, messageId, userId, serviceId, kind, amount, callbackQueryId) {
  const kv=env.BOT_KV, s=await getSettings(kv); if ((kind==="volume" && s.features?.extra_volume===false) || (kind==="days" && s.features?.extra_days===false)) return; const cfg=kind==="volume"?s.extra_volume:s.extra_days;
  const service=await getService(kv,serviceId); if(!service||service.user_id!==userId||cfg?.enabled===false)return;
  const n=Math.min(Number(cfg.max_gb||cfg.max_days||365),Math.max(Number(cfg.min_gb||cfg.min_days||1),Number(amount||1)));
  const price=kind==="volume"?n*Number(cfg.price_per_gb||0):n*Number(cfg.price_per_day||0);
  const user=await getUser(kv,userId);
  if(user.balance<price){return telegram.editOrSend(chatId,messageId,`💰 هزینه: ${toman(price)}\n\n❌ موجودی کیف پول کافی نیست.`,{reply_markup:keyboard([{text:"💳 شارژ کیف پول",data:"wallet:charge"}],{perRow:1,back:`svc:view:${serviceId}`})});}
  if(kind==="volume"){
    const buttons=[{text:"➖",data:`svc:addvol:${serviceId}:${Math.max(1,n-1)}`},{text:`${n} GB`,data:`svc:addvol:${serviceId}:${n}`},{text:"➕",data:`svc:addvol:${serviceId}:${Math.min(Number(cfg.max_gb||500),n+1)}`},{text:`💳 پرداخت ${toman(price)}`,data:`svc:addvolpay:${serviceId}:${n}`}];
    return telegram.editOrSend(chatId,messageId,`➕ <b>افزایش حجم سرویس</b>\n\n📦 مقدار اضافه: ${n}GB\n💰 هزینه: ${toman(price)}\n💼 موجودی: ${toman(user.balance)}`,{reply_markup:keyboard(buttons,{perRow:3,back:`svc:view:${serviceId}`})});
  }
  const buttons=[{text:"➖",data:`svc:adddays:${serviceId}:${Math.max(1,n-1)}`},{text:`${n} روز`,data:`svc:adddays:${serviceId}:${n}`},{text:"➕",data:`svc:adddays:${serviceId}:${Math.min(Number(cfg.max_days||365),n+1)}`},{text:`💳 پرداخت ${toman(price)}`,data:`svc:adddayspay:${serviceId}:${n}`}];
  return telegram.editOrSend(chatId,messageId,`⏳ <b>افزایش مدت سرویس</b>\n\n🗓 مدت اضافه: ${n} روز\n💰 هزینه: ${toman(price)}\n💼 موجودی: ${toman(user.balance)}`,{reply_markup:keyboard(buttons,{perRow:3,back:`svc:view:${serviceId}`})});
}

export async function showAddVolume(env,telegram,chatId,messageId,userId,serviceId,amount,callbackQueryId){return addOn(env,telegram,chatId,messageId,userId,serviceId,"volume",amount,callbackQueryId);}
export async function showAddDays(env,telegram,chatId,messageId,userId,serviceId,amount,callbackQueryId){return addOn(env,telegram,chatId,messageId,userId,serviceId,"days",amount,callbackQueryId);}

async function confirmAddOn(env,telegram,chatId,messageId,userId,serviceId,kind,amount,callbackQueryId){
  const kv=env.BOT_KV,s=await getSettings(kv),service=await getService(kv,serviceId);if(!service||service.user_id!==userId)return;
  const cfg=kind==="volume"?s.extra_volume:s.extra_days,n=Number(amount),price=kind==="volume"?n*Number(cfg.price_per_gb||0):n*Number(cfg.price_per_day||0); let debited=false;
  try{await withUserLock(env,userId,async()=>{const fresh=await getService(kv,serviceId);const user=await getUser(kv,userId);if(!fresh||user.balance<price)throw Error("INSUFFICIENT");await addTransaction(kv,userId,{type:kind==="volume"?"extra_volume":"extra_days",amount:-price,description:`افزایش ${kind==="volume"?`${n}GB حجم`:`${n} روز مدت`} سرویس #${serviceId}`});debited=true;const panel=await getPanel(kv,fresh.panel_id);if(!panel)throw Error("پنل سرویس یافت نشد");const adapter=adapterFor(panel),profile=fresh.profile_id?(await getProfiles(kv,panel.id)).find(p=>p.id===fresh.profile_id):null;if(kind==="volume"){if(!adapter.addVolume)throw Error("افزایش حجم در این پنل پشتیبانی نمی‌شود");if(panel.type==="threexui")await adapter.addVolume(panel,profile,fresh.username,n,fresh.volume_gb);else await adapter.addVolume(panel,fresh.username,n,fresh.volume_gb);fresh.volume_gb=Number(fresh.volume_gb||0)+n;}else{if(!adapter.extendUser)throw Error("افزایش مدت در این پنل پشتیبانی نمی‌شود");const oldExpiry=Number(fresh.expires_at);if(panel.type==="threexui")await adapter.extendUser(panel,profile,fresh.username,n,oldExpiry);else await adapter.extendUser(panel,fresh.username,n,oldExpiry);fresh.expires_at=Math.max(Date.now(),oldExpiry)+n*86400000;}await saveService(kv,fresh);});await telegram.answerCallbackQuery(callbackQueryId,"✅ انجام شد");return showServiceDetail(env,telegram,chatId,messageId,serviceId);}catch(e){if(e.message==="INSUFFICIENT")return telegram.answerCallbackQuery(callbackQueryId,"❌ موجودی کافی نیست",true);if(debited)await addTransactionSafe(env,userId,{type:"refund",amount:price,description:`بازگشت وجه افزایش سرویس #${serviceId}`});await telegram.sendMessage(chatId,`⚠️ عملیات انجام نشد.\n\n💸 مبلغ ${toman(price)} به کیف پول شما برگشت داده شد.`);return showServiceDetail(env,telegram,chatId,messageId,serviceId);}}

export async function confirmAddVolume(env,tg,c,m,u,s,a,q){return confirmAddOn(env,tg,c,m,u,s,"volume",a,q)}
export async function confirmAddDays(env,tg,c,m,u,s,a,q){return confirmAddOn(env,tg,c,m,u,s,"days",a,q)}

export async function confirmDeleteService(env,telegram,chatId,messageId,userId,serviceId){const s=await getService(env.BOT_KV,serviceId);if(!s||s.user_id!==userId)return;await telegram.editOrSend(chatId,messageId,`⚠️ سرویس #${serviceId} حذف شود؟\nاین کار سرویس روی پنل را هم غیرفعال می‌کند.`,{reply_markup:keyboard([{text:"❌ انصراف",data:`svc:view:${serviceId}`},{text:"🗑 حذف قطعی",data:`svc:delete:${serviceId}`}],{perRow:2,back:`svc:view:${serviceId}`})});}
export async function deleteService(env,telegram,chatId,messageId,userId,serviceId){const kv=env.BOT_KV,s=await getService(kv,serviceId);if(!s||s.user_id!==userId)return;try{const p=await getPanel(kv,s.panel_id);if(p){const a=adapterFor(p),profile=s.profile_id?(await getProfiles(kv,p.id)).find(x=>x.id===s.profile_id):null;if(a.deleteUser){if(p.type==="threexui")await a.deleteUser(p,profile,s.username);else await a.deleteUser(p,s.username);}}}catch(e){console.log("delete service panel error",e);}s.status="disabled";s.deleted_at=Date.now();await saveService(kv,s);await telegram.sendMessage(chatId,"🗑 سرویس حذف شد.",{reply_markup:keyboard([{text:"🏠 منوی اصلی",data:"menu:main"}],{perRow:1})});}
export async function regenerateSubscription(env,telegram,chatId,messageId,userId,serviceId){const kv=env.BOT_KV,s=await getService(kv,serviceId);if(!s||s.user_id!==userId)return;const p=await getPanel(kv,s.panel_id);if(!p)return;const a=adapterFor(p);if(!a.regenerateSubscription)return telegram.editOrSend(chatId,messageId,"❌ ساخت دوباره لینک ساب برای این نوع پنل پشتیبانی نمی‌شود.",{reply_markup:keyboard([],{back:`svc:view:${serviceId}`})});try{const profile=s.profile_id?(await getProfiles(kv,p.id)).find(x=>x.id===s.profile_id):null;const url=await a.regenerateSubscription(p,profile,s.username);s.subscription_url=url;await saveService(kv,s);return showServiceDetail(env,telegram,chatId,messageId,serviceId);}catch(e){await telegram.sendMessage(chatId,"❌ ساخت دوباره لینک ساب ناموفق بود.");}}
