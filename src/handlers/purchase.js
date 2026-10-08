import { keyboard } from "../lib/keyboards.js";
import { setState, clearState } from "../lib/state.js";
import { reportPurchase } from "../lib/report.js";
import { logPurchase, logFailedPurchase } from "../lib/log.js";
import {
  getCategories, listProductsByCategory, getProduct, getDiscount, saveDiscount,
  getUser, addTransaction, addTransactionSafe, createOrder, saveOrder, createService, getPanel,
  getProfiles, getStats, saveStats, getSettings, getTexts, render, getUserOrders,
  getAdmins, listInventory, claimInventoryItemSafe,
} from "../lib/kv.js";
import { provisionUser } from "../lib/panels/index.js";
import { withUserLock } from "../lib/locks.js";

function toman(n) { return Number(n || 0).toLocaleString("en-US") + " تومان"; }

async function feature(kv, key) {
  const s = await getSettings(kv);
  return s.features?.[key] !== false;
}

async function maybeRewardReferrer(kv, buyerId, orderAmount) {
  const buyer = await getUser(kv, buyerId);
  if (!buyer?.referred_by || buyer.ref_reward_paid) return;
  const priorOrders = await getUserOrders(kv, buyerId);
  if (priorOrders.filter((o) => o?.status === "completed").length > 1) return;
  const referrer = await getUser(kv, buyer.referred_by);
  if (!referrer) return;
  const settings = await getSettings(kv);
  const reward = Math.round((orderAmount * (settings.ref_reward_percent || 0)) / 100);
  if (reward <= 0) return;
  // Referral rewards are also wallet mutations and therefore use the same lock.
  await addTransactionSafe({ BOT_KV: kv }, referrer.id, { type: "referral_reward", amount: reward, description: `پاداش دعوت (کاربر ${buyerId})` });
  referrer.ref_earnings = (referrer.ref_earnings || 0) + reward;
  await (await import("../lib/kv.js")).saveUser(kv, referrer);
  buyer.ref_reward_paid = true;
  await (await import("../lib/kv.js")).saveUser(kv, buyer);
}

// True when at least one active category contains an active product.
async function hasSellableCategories(kv) {
  const categories = (await getCategories(kv)).filter((c) => c.active);
  for (const c of categories) {
    const products = (await listProductsByCategory(kv, c.id)).filter((p) => p.active);
    if (products.length) return true;
  }
  return false;
}

export async function showCategories(env, telegram, chatId, messageId) {
  const kv = env.BOT_KV;
  const settings = await getSettings(kv);
  const texts = await getTexts(kv);
  const customOn = settings.features?.custom_volume !== false && settings.custom_volume?.enabled !== false;
  const categories = (await getCategories(kv)).filter((c) => c.active);

  // No category/product configured -> skip the empty list and open custom volume directly.
  if (!(await hasSellableCategories(kv))) {
    if (customOn) return showCustomVolume(env, telegram, chatId, messageId, undefined, undefined, "menu:main");
    await telegram.editOrSend(chatId, messageId, texts.buy_no_categories, { reply_markup: keyboard([], { back: "menu:main" }) });
    return;
  }
  const buttons = categories.sort((a,b)=>(a.order||0)-(b.order||0)).map((c) => ({ text: c.name, data: `buy:cat:${c.id}` }));
  if (customOn) {
    buttons.push({ text: "🎛 حجم دلخواه", data: "buy:custom:main" });
  }
  await telegram.editOrSend(chatId, messageId, texts.buy_pick_category, { reply_markup: keyboard(buttons, { perRow: 2, back: "menu:main" }) });
}

export async function showProducts(env, telegram, chatId, messageId, categoryId) {
  const products = (await listProductsByCategory(env.BOT_KV, categoryId)).filter((p) => p.active);
  const texts = await getTexts(env.BOT_KV);
  if (!products.length) {
    await telegram.editOrSend(chatId, messageId, texts.buy_no_products, { reply_markup: keyboard([], { back: "buy:categories" }) });
    return;
  }
  const buttons = products.map((p) => ({ text: `${p.volume_gb}GB • ${p.duration_days}روز • ${toman(p.price)}`, data: `buy:prod:${p.id}` }));
  await telegram.editOrSend(chatId, messageId, texts.buy_pick_product, { reply_markup: keyboard(buttons, { perRow: 2, back: "buy:categories" }) });
}

function priceAfterDiscount(product, discount) {
  if (!discount) return Number(product.price || 0);
  return discount.type === "percent" ? Math.max(0, Math.round(product.price * (1 - discount.value / 100))) : Math.max(0, product.price - discount.value);
}

// The applied discount code is stored server-side (per user + product) instead of
// being packed into callback_data: Telegram limits callback_data to 64 bytes, and
// codes containing ':' / Persian letters / long text broke the buttons.
const appliedKey = (userId, productId) => `applied_disc:${userId}:${productId}`;
async function getAppliedDiscount(kv, userId, productId) { return kv.get(appliedKey(userId, productId)); }
async function resolveDiscountCode(kv, userId, productId, flag) {
  if (!flag || flag === "-") return null;
  if (flag === "d") return getAppliedDiscount(kv, userId, productId);
  return flag; // legacy buttons that still carry the raw code
}
function normalizeCode(s) {
  return String(s || "")
    .replace(/[\u200b\u200c\u200d\u200e\u200f\ufeff]/g, "")
    .replace(/[۰-۹]/g, (d) => "۰۱۲۳۴۵۶۷۸۹".indexOf(d))
    .replace(/[٠-٩]/g, (d) => "٠١٢٣٤٥٦٧٨٩".indexOf(d))
    .trim();
}

export async function removeAppliedDiscount(env, telegram, chatId, messageId, userId, productId) {
  await env.BOT_KV.delete(appliedKey(userId, productId));
  return showProductDetail(env, telegram, chatId, messageId, productId, null, userId);
}

export async function showProductDetail(env, telegram, chatId, messageId, productId, discountCode, userId) {
  const product = await getProduct(env.BOT_KV, productId);
  if (!product) {
    const texts = await getTexts(env.BOT_KV);
    return telegram.editOrSend(chatId, messageId, texts.buy_product_gone, { reply_markup: keyboard([], { back: "buy:categories" }) });
  }
  if (!discountCode && userId) discountCode = await getAppliedDiscount(env.BOT_KV, userId, productId);
  const discount = discountCode ? await validDiscountFor(env.BOT_KV, discountCode, product) : null;
  const finalPrice = priceAfterDiscount(product, discount);
  let text = `🛍 <b>${product.name}</b>\n\n${product.description ? product.description + "\n\n" : ""}📦 حجم: ${product.volume_gb}GB\n⏳ مدت: ${product.duration_days} روز\n🔌 پروتکل: ${product.protocol}\n\n💰 قیمت: ${toman(product.price)}\n`;
  if (discount) text += `🎟 تخفیف: ${discount.code}\n💵 قیمت نهایی: ${toman(finalPrice)}\n`;
  const buttons = [{ text: "💳 پرداخت از کیف پول", data: `buy:pay:${product.id}:${discount ? "d" : "-"}` }];
  if (!discount) buttons.push({ text: "🎟 وارد کردن کد تخفیف", data: `buy:discount:${product.id}` });
  else buttons.push({ text: "❌ حذف کد تخفیف", data: `buy:nodisc:${product.id}` });
  await telegram.editOrSend(chatId, messageId, text, { reply_markup: keyboard(buttons, { perRow: 1, back: `buy:cat:${product.category_id}` }) });
}

async function validDiscountFor(kv, code, product) {
  const discount = await getDiscount(kv, code);
  if (!discount || !discount.active || (discount.expires_at && Date.now() > discount.expires_at) || (discount.max_uses && discount.uses >= discount.max_uses)) return null;
  if (discount.product_id && discount.product_id !== product.id) return null;
  if (discount.category_id && discount.category_id !== product.category_id) return null;
  return discount;
}

export async function promptDiscountCode(env, telegram, chatId, messageId, userId, productId) {
  const texts = await getTexts(env.BOT_KV);
  await setState(env, userId, { step: "await_discount_code", product_id: productId });
  await telegram.editOrSend(chatId, messageId, texts.buy_discount_prompt, { reply_markup: keyboard([], { back: `buy:prod:${productId}` }) });
}

export async function handleDiscountCodeInput(env, telegram, message, state) {
  const product = await getProduct(env.BOT_KV, state.product_id);
  await clearState(env, message.from.id);
  const discount = product ? await validDiscountFor(env.BOT_KV, normalizeCode(message.text), product) : null;
  if (!discount) return telegram.sendMessage(message.chat.id, (await getTexts(env.BOT_KV)).buy_discount_invalid, { reply_markup: keyboard([{ text: "🛍 بازگشت", data: `buy:prod:${state.product_id}` }], { perRow: 1 }) });
  await env.BOT_KV.put(appliedKey(message.from.id, product.id), discount.code, { expirationTtl: 3600 });
  return showProductDetail(env, telegram, message.chat.id, null, product.id, discount.code, message.from.id);
}

export async function showPayConfirm(env, telegram, chatId, messageId, userId, productId, discountCode) {
  const product = await getProduct(env.BOT_KV, productId);
  if (!product) return;
  const code = await resolveDiscountCode(env.BOT_KV, userId, productId, discountCode);
  const discount = code ? await validDiscountFor(env.BOT_KV, code, product) : null;
  const finalPrice = priceAfterDiscount(product, discount);
  const user = await getUser(env.BOT_KV, userId);
  const text = `🛒 <b>${product.name}</b>\n\n${discount ? `🎟 کد تخفیف: ${discount.code}\n` : ""}💰 قیمت: ${toman(finalPrice)}\n💼 موجودی: ${toman(user.balance)}\n\n${user.balance < finalPrice ? (await getTexts(env.BOT_KV)).buy_insufficient_balance : "با تأیید، مبلغ از کیف پول کسر و سرویس ساخته می‌شود."}`;
  const buttons = user.balance < finalPrice ? [{ text: "💳 شارژ کیف پول", data: "wallet:charge" }] : [{ text: "✅ تأیید خرید", data: `buy:confirm:${product.id}:${discount ? "d" : "-"}` }, { text: "❌ لغو", data: `buy:prod:${product.id}` }];
  await telegram.editOrSend(chatId, messageId, text, { reply_markup: keyboard(buttons, { perRow: 2, back: `buy:prod:${product.id}` }) });
}

// ---------- custom volume ----------
function customPrice(cfg, volume, days) {
  const baseV = Number(cfg.base_volume_gb || 0), baseD = Number(cfg.base_duration_days || 0);
  return Math.max(0, Number(cfg.base_price || 0) + Math.max(0, volume - baseV) * Number(cfg.extra_gb_price || 0) + Math.max(0, days - baseD) * Number(cfg.extra_day_price || 0));
}
function clamp(n, min, max) { return Math.min(max, Math.max(min, n)); }

export async function showCustomVolume(env, telegram, chatId, messageId, volume, days, backTo) {
  const settings = await getSettings(env.BOT_KV), texts = await getTexts(env.BOT_KV), cfg = settings.custom_volume || {};
  if (settings.features?.custom_volume === false || cfg.enabled === false) return telegram.editOrSend(chatId, messageId, texts.custom_volume_unavailable, { reply_markup: keyboard([], { back: "menu:main" }) });
  // When there is no category list to go back to, "back" returns to the main menu.
  if (!backTo) backTo = (await hasSellableCategories(env.BOT_KV)) ? "buy:categories" : "menu:main";
  const v = clamp(Number(volume || cfg.base_volume_gb || 1), Number(cfg.min_volume_gb || 1), Number(cfg.max_volume_gb || 1000));
  const d = clamp(Number(days || cfg.base_duration_days || 1), Number(cfg.min_duration_days || 1), Number(cfg.max_duration_days || 365));
  const price = customPrice(cfg, v, d);
  const text = `${texts.custom_volume_title}\n\n${texts.custom_volume_description}\n\n${render(texts.custom_volume_summary, { volume:v, days:d, price:toman(price) })}\n\n💡 هر + یعنی ۱ واحد بیشتر.`;
  const buttons = [
    { text: "➖ حجم", data: `buy:custom:${clamp(v-1,cfg.min_volume_gb,cfg.max_volume_gb)}:${d}` },
    { text: `📦 ${v} GB`, data: `buy:custom:${v}:${d}` },
    { text: "➕ حجم", data: `buy:custom:${clamp(v+1,cfg.min_volume_gb,cfg.max_volume_gb)}:${d}` },
    { text: "➖ روز", data: `buy:custom:${v}:${clamp(d-1,cfg.min_duration_days,cfg.max_duration_days)}` },
    { text: `⏳ ${d} روز`, data: `buy:custom:${v}:${d}` },
    { text: "➕ روز", data: `buy:custom:${v}:${clamp(d+1,cfg.min_duration_days,cfg.max_duration_days)}` },
    { text: `💳 پرداخت ${toman(price)}`, data: `buy:custompay:${v}:${d}` },
  ];
  await telegram.editOrSend(chatId, messageId, text, { reply_markup: keyboard(buttons, { perRow: 3, back: backTo }) });
}

export async function showCustomPay(env, telegram, chatId, messageId, userId, volume, days) {
  const settings = await getSettings(env.BOT_KV), cfg = settings.custom_volume || {}, texts = await getTexts(env.BOT_KV);
  volume=clamp(Number(volume),Number(cfg.min_volume_gb||1),Number(cfg.max_volume_gb||1000)); days=clamp(Number(days),Number(cfg.min_duration_days||1),Number(cfg.max_duration_days||365));
  const price = customPrice(cfg, volume, days), user = await getUser(env.BOT_KV, userId);
  const text = `${texts.custom_volume_title}\n\n${render(texts.custom_volume_summary, { volume, days, price:toman(price) })}\n💼 موجودی کیف پول: ${toman(user.balance)}`;
  const buttons = user.balance >= price ? [{ text: "✅ تأیید و ساخت سرویس", data: `buy:customconfirm:${volume}:${days}` }] : [{ text: "💳 شارژ کیف پول", data: "wallet:charge" }];
  await telegram.editOrSend(chatId, messageId, text, { reply_markup: keyboard(buttons, { perRow: 1, back: `buy:custom:${volume}:${days}` }) });
}

export async function confirmCustomPurchase(env, telegram, chatId, messageId, userId, volume, days, callbackQueryId) {
  const settings = await getSettings(env.BOT_KV), cfg = settings.custom_volume || {}, texts = await getTexts(env.BOT_KV);
  volume=clamp(Number(volume),Number(cfg.min_volume_gb||1),Number(cfg.max_volume_gb||1000)); days=clamp(Number(days),Number(cfg.min_duration_days||1),Number(cfg.max_duration_days||365));
  const price = customPrice(cfg, volume, days);
  const kv = env.BOT_KV;
  let completed=false, createdOrder=null, debited=false, lockAcquired=false;
  try {
    await withUserLock(env, userId, async () => {
      const user = await getUser(env.BOT_KV, userId);
      if (!user || user.balance < price) throw new Error("INSUFFICIENT");
      const purchaseKey=`purchase:inflight:${userId}`; if(await env.BOT_KV.get(purchaseKey)) throw Error("BUSY"); await env.BOT_KV.put(purchaseKey,String(Date.now()),{expirationTtl:60}); lockAcquired=true;
      await addTransaction(kv, userId, { type:"custom_purchase", amount:-price, description:`خرید حجم دلخواه ${volume}GB / ${days} روز` }); debited=true;
      const order = await createOrder(env.BOT_KV, { user_id:userId, product_id:null, custom:true, volume_gb:volume, duration_days:days, price, status:"processing" }); createdOrder=order;
      await telegram.editOrSend(chatId, messageId, texts.buy_success_processing);
      let service = null;
      // Inventory first when configured.
      if (cfg.source === "inventory") {
        const items = (await listInventory(env.BOT_KV)).filter(i => i.status !== "sold" && Number(i.volume_gb) >= Number(volume) && Number(i.duration_days) >= Number(days));
        const item = items.sort((a,b)=>(Number(a.volume_gb)-volume)-(Number(b.volume_gb)-volume))[0];
        if (item) {
          const claimed = await claimInventoryItemSafe(env, item.id);
          if (claimed) {
            service = await createService(env.BOT_KV, { user_id:userId, order_id:order.id, product_id:null, panel_id:claimed.panel_id||null, profile_id:claimed.profile_id||null, username:claimed.username, subscription_url:claimed.subscription_url, volume_gb:claimed.volume_gb, expires_at:Date.now()+Number(days)*86400000, status:"active", source:"inventory", inventory_id:claimed.id });
          }
        }
        if (!service && !cfg.inventory_fallback) throw new Error("موجودی انبار برای این حجم/مدت کافی نیست");
      }
      if (!service) {
        let panel = cfg.panel_id ? await getPanel(env.BOT_KV, cfg.panel_id) : null;
        if (!panel) {
          const ids = await (await import("../lib/kv.js")).getPanelIndex(env.BOT_KV);
          const panels = (await Promise.all(ids.map(id=>getPanel(env.BOT_KV,id)))).filter(p=>p?.active);
          // Lowest active service count first; fall back to first healthy panel.
          const serviceIds = await (await import("../lib/kv.js")).getActiveServiceIndex(env.BOT_KV);
          const svcs = await Promise.all(serviceIds.map(async id=>(await import("../lib/kv.js")).getService(env.BOT_KV,id)));
          const counts = panels.map(p => ({ p, n: svcs.filter(s=>s?.panel_id===p.id&&s.status!=="disabled").length }));
          panel = counts.sort((a,b)=>a.n-b.n)[0]?.p || null;
        }
        if (!panel) throw new Error("هیچ پنل فعالی برای ساخت سرویس وجود ندارد");
        let profile = cfg.profile_id ? (await getProfiles(env.BOT_KV,panel.id)).find(p=>p.id===cfg.profile_id) : null;
        if (!profile) profile = (await getProfiles(env.BOT_KV,panel.id)).find(p=>p.active);
        if (!profile) throw new Error("پروفایل فعال برای حجم دلخواه وجود ندارد");
        const result = await provisionUser(panel, profile, { username:`u${userId}_${order.id}`, volumeGB:Number(volume), days:Number(days) });
        service = await createService(env.BOT_KV, { user_id:userId, order_id:order.id, product_id:null, panel_id:panel.id, profile_id:profile.id, username:result.username, subscription_url:result.subscription_url, volume_gb:Number(volume), expires_at:Date.now()+Number(days)*86400000, status:"active", source:"panel" });
      }
      order.status="completed"; order.service_id=service.id; await saveOrder(env.BOT_KV,order); completed=true; await env.BOT_KV.delete(`purchase:inflight:${userId}`);
      const stats=await getStats(env.BOT_KV); stats.total_orders+=1; stats.total_sales+=price; await saveStats(env.BOT_KV,stats);
      await reportPurchase(env,telegram,user,{name:`حجم دلخواه ${volume}GB / ${days} روز`},price);
      await logPurchase(env,telegram,user,{name:`حجم دلخواه ${volume}GB / ${days} روز`},price);
      const ready=render(texts.buy_service_ready,{username:service.username,volume:service.volume_gb,expires:new Date(service.expires_at).toLocaleDateString("fa-IR")});
      await telegram.editOrSend(chatId,messageId,ready,{reply_markup:keyboard([{text:"🔍 مشاهده سرویس",data:`svc:view:${service.id}`}],{perRow:1,back:"menu:main"})});
    });
  } catch(e) {
    if (lockAcquired) await kv.delete(`purchase:inflight:${userId}`).catch(()=>{});
    if (String(e?.message)==="INSUFFICIENT") return telegram.answerCallbackQuery(callbackQueryId,texts.buy_insufficient_balance,true);
    if (String(e?.message)==="BUSY") return telegram.answerCallbackQuery(callbackQueryId,"⏳ درخواست قبلی شما در حال انجام است. چند ثانیه صبر کنید.",true);
    if (completed) { console.log("custom purchase completed but post-send step failed", e); return; }
    console.log("custom purchase failed", e);
    if (createdOrder) { createdOrder.status="failed"; try { await saveOrder(kv,createdOrder); } catch {} }
    let refunded = false;
    if (debited) { try { await addTransactionSafe(env,userId,{type:"refund",amount:price,description:`بازگشت وجه خرید حجم دلخواه ${volume}GB / ${days} روز`}); refunded = true; } catch (re) { console.log("custom refund failed", re); } }
    // Everything (error + refund) goes into the ONE main message instead of a separate one.
    const failText = `${texts.buy_provision_failed}` + (refunded ? `\n\n💸 مبلغ ${toman(price)} به کیف پول شما برگشت داده شد.` : "");
    await telegram.editOrSend(chatId,messageId,failText,{reply_markup:keyboard([],{back:"buy:categories"})});
    await notifyPurchaseFailureAdmins(env,telegram,userId,{name:`حجم دلخواه ${volume}GB / ${days} روز`},price,String(e?.message||e));
  }
}

// ---------- fixed product payment ----------
export async function handlePurchaseConfirm(env, telegram, chatId, messageId, userId, productId, discountCode, callbackQueryId) {
  const kv=env.BOT_KV, product=await getProduct(kv,productId); if(!product) return;
  const texts=await getTexts(kv);
  const appliedCode=await resolveDiscountCode(kv,userId,productId,discountCode);
  let discount=appliedCode?await validDiscountFor(kv,appliedCode,product):null;
  if(appliedCode && !discount) return telegram.answerCallbackQuery(callbackQueryId,"کد تخفیف دیگر معتبر نیست. دوباره بررسی کنید.",true);
  const finalPrice=priceAfterDiscount(product,discount);
  let completed=false, createdOrder=null, debited=false, discountIncremented=false;
  try {
    await withUserLock(env,userId,async()=>{
      const user=await getUser(kv,userId); if(!user || user.balance<finalPrice) throw new Error("INSUFFICIENT");
      if(discount){const fresh=await validDiscountFor(kv,discount.code,product);if(!fresh||priceAfterDiscount(product,fresh)!==finalPrice)throw new Error("DISCOUNT_INVALID");discount=fresh;}
      const purchaseKey=`purchase:inflight:${userId}`; if(await kv.get(purchaseKey)) throw Error("BUSY"); await kv.put(purchaseKey,String(Date.now()),{expirationTtl:60});
      await addTransaction(kv,userId,{type:"purchase",amount:-finalPrice,description:`خرید ${product.name}`}); debited=true;
      const order=await createOrder(kv,{user_id:userId,product_id:product.id,price:finalPrice,discount_code:discount?.code||null,status:"processing"}); createdOrder=order;
      if(discount){discount.uses=(discount.uses||0)+1;await saveDiscount(kv,discount);discountIncremented=true;}
      await telegram.editOrSend(chatId,messageId,texts.buy_success_processing);
      const candidateIds=Array.isArray(product.panel_ids)&&product.panel_ids.length?product.panel_ids:[product.panel_id];
      const activeServices=await (async()=>{const ids=await (await import("../lib/kv.js")).getActiveServiceIndex(kv);return Promise.all(ids.map(async id=>(await import("../lib/kv.js")).getService(kv,id)));})();
      const candidates=[];
      for(const pid of candidateIds.filter(Boolean)){const panel=await getPanel(kv,pid);if(!panel?.active)continue;const profiles=await getProfiles(kv,pid);const profile=profiles.find(p=>p.id===product.profile_id)||profiles.find(p=>p.active);if(profile)candidates.push({panel,profile,count:activeServices.filter(x=>x?.panel_id===pid&&x.status!=="disabled").length});}
      candidates.sort((a,b)=>a.count-b.count); if(!candidates.length)throw new Error("پنل یا پروفایل تنظیم نشده");
      let panel,profile,result,lastError;
      for(const candidate of candidates){try{panel=candidate.panel;profile=candidate.profile;result=await provisionUser(panel,profile,{username:`u${userId}_${order.id}`,volumeGB:product.volume_gb,days:product.duration_days});break;}catch(err){lastError=err;}}
      if(!result)throw (lastError||new Error("ساخت سرویس روی همه پنل‌ها ناموفق بود"));
      const service=await createService(kv,{user_id:userId,order_id:order.id,product_id:product.id,panel_id:panel.id,profile_id:profile.id,inbound_id:profile.inbound_id||null,username:result.username,remote_client_id:result.client_id||null,remote_sub_id:result.sub_id||null,subscription_url:result.subscription_url,volume_gb:product.volume_gb,expires_at:Date.now()+product.duration_days*86400000,status:"active"});
      order.status="completed";order.service_id=service.id;await saveOrder(kv,order); completed=true; await kv.delete(`purchase:inflight:${userId}`); await kv.delete(appliedKey(userId,product.id));
      const stats=await getStats(kv);stats.total_orders+=1;stats.total_sales+=finalPrice;await saveStats(kv,stats);
      await maybeRewardReferrer(kv,userId,finalPrice);await reportPurchase(env,telegram,user,product,finalPrice);await logPurchase(env,telegram,user,product,finalPrice);
      const text=render(texts.buy_service_ready,{username:service.username,volume:service.volume_gb,expires:new Date(service.expires_at).toLocaleDateString("fa-IR")});
      await telegram.editOrSend(chatId,messageId,text,{reply_markup:keyboard([{text:"🔍 مشاهده سرویس",data:`svc:view:${service.id}`}],{perRow:1,back:"menu:main"})});
    });
  } catch(e) {
    if(String(e?.message)!=="BUSY") await kv.delete(`purchase:inflight:${userId}`);
    if(String(e?.message)==="INSUFFICIENT") return telegram.answerCallbackQuery(callbackQueryId,texts.buy_insufficient_balance,true);
    if(String(e?.message)==="DISCOUNT_INVALID") return telegram.answerCallbackQuery(callbackQueryId,"کد تخفیف دیگر معتبر نیست. دوباره بررسی کنید.",true);
    if(String(e?.message)==="BUSY") return telegram.answerCallbackQuery(callbackQueryId,"⏳ درخواست قبلی شما در حال انجام است. چند ثانیه صبر کنید.",true);
    if (createdOrder && !completed) { createdOrder.status="failed"; await saveOrder(kv,createdOrder); }
    if (discountIncremented && !completed && discount) { discount.uses=Math.max(0,(discount.uses||1)-1); await saveDiscount(kv,discount); }
    if (debited && !completed) await withUserLock(env,userId,async()=>{ await addTransaction(kv,userId,{type:"refund",amount:finalPrice,description:`بازگشت وجه خرید ناموفق ${product.name}`}); });
    if (completed) { console.log("purchase completed but post-send step failed",e); return; }
    const user=await getUser(kv,userId);
    await telegram.editOrSend(chatId,messageId,`${texts.buy_provision_failed}` + (debited ? `\n\n💸 مبلغ ${toman(finalPrice)} به کیف پول شما برگشت داده شد.` : ""),{reply_markup:keyboard([],{back:`buy:prod:${product.id}`})});
    try{await logFailedPurchase(env,telegram,user,product,String(e).slice(0,200));}catch{}
    await notifyPurchaseFailureAdmins(env,telegram,userId,product,finalPrice,String(e));
  }
}

async function notifyPurchaseFailureAdmins(env,telegram,userId,product,amount,reason){
  try{const admins=await getAdmins(env.BOT_KV);const msg=`⚠️ <b>خرید ناموفق و بازپرداخت شد</b>\n👤 کاربر: <code>${userId}</code>\n📦 ${product.name}\n💸 بازگشت: ${toman(amount)}\n❗ ${String(reason).replace(/[<>&]/g,"").slice(0,300)}`;await Promise.all(admins.map(a=>telegram.sendMessage(a.id,msg)));}catch{}
}
