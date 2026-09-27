import { keyboard } from "../lib/keyboards.js";
import { setState, getState, clearState } from "../lib/state.js";
import { reportPurchase } from "../lib/report.js";
import { logPurchase, logFailedPurchase } from "../lib/log.js";
import {
  getCategories,
  listProductsByCategory,
  getProduct,
  getDiscount,
  saveDiscount,
  getUser,
  saveUser,
  addTransaction,
  createOrder,
  saveOrder,
  createService,
  getPanel,
  getProfiles,
  getStats,
  saveStats,
  getSettings,
  getTexts,
  render,
  getUserOrders,
} from "../lib/kv.js";
import { provisionUser } from "../lib/panels/index.js";

function toman(n) {
  return n.toLocaleString("en-US") + " تومان";
}

// Referral reward pays out once - on the referred user's first completed order.
async function maybeRewardReferrer(kv, buyerId, orderAmount) {
  const buyer = await getUser(kv, buyerId);
  if (!buyer.referred_by || buyer.ref_reward_paid) return;

  const priorOrders = await getUserOrders(kv, buyerId);
  const completedBefore = priorOrders.filter((o) => o.status === "completed").length;
  if (completedBefore > 1) return; // this order is already saved as completed by the caller; >1 means not the first

  const referrer = await getUser(kv, buyer.referred_by);
  if (!referrer) return;

  const settings = await getSettings(kv);
  const reward = Math.round((orderAmount * (settings.ref_reward_percent || 0)) / 100);
  if (reward <= 0) return;

  await addTransaction(kv, referrer.id, {
    type: "referral_reward",
    amount: reward,
    description: `پاداش دعوت (کاربر ${buyerId})`,
  });
  referrer.ref_earnings = (referrer.ref_earnings || 0) + reward;
  await saveUser(kv, referrer);

  buyer.ref_reward_paid = true;
  await saveUser(kv, buyer);
}

// ---------- categories ----------

export async function showCategories(env, telegram, chatId, messageId) {
  const categories = (await getCategories(env.BOT_KV)).filter((c) => c.active);
  const texts = await getTexts(env.BOT_KV);
  if (categories.length === 0) {
    await telegram.editOrSend(chatId, messageId, texts.buy_no_categories, {
      reply_markup: keyboard([], { back: "menu:main" }),
    });
    return;
  }
  const buttons = categories
    .sort((a, b) => (a.order || 0) - (b.order || 0))
    .map((c) => ({ text: c.name, data: `buy:cat:${c.id}` }));

  await telegram.editOrSend(chatId, messageId, texts.buy_pick_category, {
    reply_markup: keyboard(buttons, { back: "menu:main" }),
  });
}

// ---------- products ----------

export async function showProducts(env, telegram, chatId, messageId, categoryId) {
  const products = (await listProductsByCategory(env.BOT_KV, categoryId)).filter((p) => p.active);
  const texts = await getTexts(env.BOT_KV);
  if (products.length === 0) {
    await telegram.editOrSend(chatId, messageId, texts.buy_no_products, {
      reply_markup: keyboard([], { back: "buy:categories" }),
    });
    return;
  }
  const buttons = products.map((p) => ({
    text: `${p.name} - ${toman(p.price)}`,
    data: `buy:prod:${p.id}`,
  }));
  await telegram.editOrSend(chatId, messageId, texts.buy_pick_product, {
    reply_markup: keyboard(buttons, { perRow: 1, back: "buy:categories" }),
  });
}

// ---------- product detail ----------

function priceAfterDiscount(product, discount) {
  if (!discount) return product.price;
  if (discount.type === "percent") return Math.max(0, Math.round(product.price * (1 - discount.value / 100)));
  return Math.max(0, product.price - discount.value);
}

export async function showProductDetail(env, telegram, chatId, messageId, productId, discountCode) {
  const product = await getProduct(env.BOT_KV, productId);
  if (!product) {
    const texts = await getTexts(env.BOT_KV);
    await telegram.editOrSend(chatId, messageId, texts.buy_product_gone, {
      reply_markup: keyboard([], { back: "buy:categories" }),
    });
    return;
  }

  let discount = null;
  if (discountCode) discount = await validDiscountFor(env.BOT_KV, discountCode, product);
  const finalPrice = priceAfterDiscount(product, discount);

  let text =
    `🛍 <b>${product.name}</b>\n\n` +
    `${product.description ? product.description + "\n\n" : ""}` +
    `📦 حجم: ${product.volume_gb}GB\n` +
    `⏳ مدت: ${product.duration_days} روز\n` +
    `🔌 پروتکل: ${product.protocol}\n\n` +
    `💰 قیمت: ${toman(product.price)}\n`;

  if (discount) {
    text += `🎟 تخفیف: ${discount.code}\n💵 قیمت نهایی: ${toman(finalPrice)}\n`;
  }

  const buttons = [{ text: "💳 پرداخت از کیف پول", data: `buy:pay:${product.id}:${discountCode || "-"}` }];
  if (!discount) buttons.push({ text: "🎟 وارد کردن کد تخفیف", data: `buy:discount:${product.id}` });

  await telegram.editOrSend(chatId, messageId, text, {
    reply_markup: keyboard(buttons, { perRow: 1, back: `buy:cat:${product.category_id}` }),
  });
}

async function validDiscountFor(kv, code, product) {
  const discount = await getDiscount(kv, code);
  if (!discount || !discount.active) return null;
  if (discount.expires_at && Date.now() > discount.expires_at) return null;
  if (discount.max_uses && discount.uses >= discount.max_uses) return null;
  if (discount.product_id && discount.product_id !== product.id) return null;
  if (discount.category_id && discount.category_id !== product.category_id) return null;
  return discount;
}

// ---------- discount code entry ----------

export async function promptDiscountCode(env, telegram, chatId, messageId, userId, productId) {
  const texts = await getTexts(env.BOT_KV);
  await setState(env, userId, { step: "await_discount_code", product_id: productId });
  await telegram.editOrSend(chatId, messageId, texts.buy_discount_prompt, {
    reply_markup: keyboard([], { back: `buy:prod:${productId}` }),
  });
}

export async function handleDiscountCodeInput(env, telegram, message, state) {
  const chatId = message.chat.id;
  const userId = message.from.id;
  const code = (message.text || "").trim();
  await clearState(env, userId);

  const product = await getProduct(env.BOT_KV, state.product_id);
  const discount = await validDiscountFor(env.BOT_KV, code, product);

  if (!discount) {
    const texts = await getTexts(env.BOT_KV);
    await telegram.sendMessage(chatId, texts.buy_discount_invalid, {
      reply_markup: keyboard([{ text: "🛍 بازگشت به محصول", data: `buy:prod:${product.id}` }], { perRow: 1 }),
    });
    return;
  }

  await showProductDetail(env, telegram, chatId, null, product.id, discount.code);
}

// ---------- payment from wallet ----------

export async function showPayConfirm(env, telegram, chatId, messageId, userId, productId, discountCode) {
  const product = await getProduct(env.BOT_KV, productId);
  const discount = discountCode !== "-" ? await validDiscountFor(env.BOT_KV, discountCode, product) : null;
  const finalPrice = priceAfterDiscount(product, discount);

  const user = await getUser(env.BOT_KV, userId);
  const texts = await getTexts(env.BOT_KV);
  const text =
    `🛒 محصول: ${product.name}\n` +
    `💰 قیمت: ${toman(finalPrice)}\n` +
    `💼 موجودی کیف پول: ${toman(user.balance)}\n` +
    `💵 مبلغ قابل پرداخت: ${toman(finalPrice)}`;

  if (user.balance < finalPrice) {
    await telegram.editOrSend(chatId, messageId, text + "\n\n" + texts.buy_insufficient_balance, {
      reply_markup: keyboard([{ text: "💳 شارژ کیف پول", data: "wallet:charge" }], {
        perRow: 1,
        back: `buy:prod:${product.id}`,
      }),
    });
    return;
  }

  await telegram.editOrSend(chatId, messageId, text, {
    reply_markup: keyboard(
      [
        { text: "✅ تأیید خرید", data: `buy:confirm:${product.id}:${discountCode}` },
        { text: "❌ لغو", data: `buy:prod:${product.id}` },
      ],
      { perRow: 2 }
    ),
  });
}

export async function handlePurchaseConfirm(env, telegram, chatId, messageId, userId, productId, discountCode, callbackQueryId) {
  const kv = env.BOT_KV;
  const product = await getProduct(kv, productId);
  if (!product) return;
  const discount = discountCode !== "-" ? await validDiscountFor(kv, discountCode, product) : null;
  const finalPrice = priceAfterDiscount(product, discount);

  const user = await getUser(kv, userId);
  const texts = await getTexts(kv);
  if (user.balance < finalPrice) {
    await telegram.answerCallbackQuery(callbackQueryId, texts.buy_insufficient_balance, true);
    return;
  }

  await addTransaction(kv, userId, {
    type: "purchase",
    amount: -finalPrice,
    description: `خرید ${product.name}`,
  });

  const order = await createOrder(kv, {
    user_id: userId,
    product_id: product.id,
    price: finalPrice,
    discount_code: discount ? discount.code : null,
    status: "processing",
  });

  if (discount) {
    discount.uses = (discount.uses || 0) + 1;
    await saveDiscount(kv, discount);
  }

  await telegram.editOrSend(chatId, messageId, texts.buy_success_processing);

  const panel = await getPanel(kv, product.panel_id);
  const profiles = await getProfiles(kv, product.panel_id);
  const profile = profiles.find((p) => p.id === product.profile_id);

  if (!panel || !profile) {
    order.status = "failed";
    await saveOrder(kv, order);
    await telegram.sendMessage(chatId, texts.buy_provision_failed_no_panel);

    // 📊 لاگ: خرید ناموفق
    try {
      await logFailedPurchase(env, telegram, user, product, "پنل یا پروفایل تنظیم نشده");
    } catch (e) {
      console.log("logFailedPurchase failed", e);
    }
    return;
  }

  try {
    const username = `u${userId}_${order.id}`;
    const result = await provisionUser(panel, profile, {
      username,
      volumeGB: product.volume_gb,
      days: product.duration_days,
    });

    const service = await createService(kv, {
      user_id: userId,
      order_id: order.id,
      product_id: product.id,
      panel_id: panel.id,
      profile_id: profile.id,
      username: result.username,
      subscription_url: result.subscription_url,
      volume_gb: product.volume_gb,
      expires_at: Date.now() + product.duration_days * 86400 * 1000,
      status: "active",
    });

    order.status = "completed";
    order.service_id = service.id;
    await saveOrder(kv, order);

    const stats = await getStats(kv);
    stats.total_orders += 1;
    stats.total_sales += finalPrice;
    await saveStats(kv, stats);

    await maybeRewardReferrer(kv, userId, finalPrice);
    await reportPurchase(env, telegram, user, product, finalPrice);

    // 📊 لاگ: خرید موفق
    try {
      await logPurchase(env, telegram, user, product, finalPrice);
    } catch (e) {
      console.log("logPurchase failed", e);
    }

    const text = render(texts.buy_service_ready, {
      username: service.username,
      volume: service.volume_gb,
      expires: new Date(service.expires_at).toLocaleDateString("fa-IR"),
    });

    await telegram.sendMessage(chatId, text, {
      reply_markup: keyboard([{ text: "🔍 مشاهده سرویس", data: `svc:view:${service.id}` }], {
        perRow: 1,
        back: "menu:main",
      }),
    });
  } catch (e) {
    console.log("purchase provisioning error", e);
    order.status = "failed";
    await saveOrder(kv, order);
    await telegram.sendMessage(chatId, texts.buy_provision_failed);

    // 📊 لاگ: خرید ناموفق
    try {
      await logFailedPurchase(env, telegram, user, product, String(e).slice(0, 200));
    } catch (err) {
      console.log("logFailedPurchase failed", err);
    }
  }
}
