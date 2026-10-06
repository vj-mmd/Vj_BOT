// All persistent state lives in Cloudflare KV (BOT_KV binding).
// KV has no querying, so every "list" (users, products, orders...) is kept
// as a small index array under one key, plus one key per record.
// KV is eventually-consistent and has no transactions: fine for a shop bot
// at normal traffic, but don't rely it for high-frequency concurrent
// writes to the exact same key (e.g. hundreds of wallet charges/sec).

async function getJSON(kv, key, fallback) {
  const v = await kv.get(key, "json");
  return v === null ? fallback : v;
}

function putJSON(kv, key, value) {
  return kv.put(key, JSON.stringify(value));
}

// ---------- id / sequence helpers ----------

async function nextId(kv, seqKey) {
  const cur = (await kv.get(seqKey)) || "0";
  const next = parseInt(cur, 10) + 1;
  await kv.put(seqKey, String(next));
  return next;
}

// ---------- users ----------

export function userKey(id) {
  return `user:${id}`;
}

export async function getUser(kv, id) {
  return getJSON(kv, userKey(id), null);
}

export async function saveUser(kv, user) {
  await putJSON(kv, userKey(user.id), user);
}

export async function getOrCreateUser(kv, from, referredBy) {
  let user = await getUser(kv, from.id);
  if (user) return { user, isNew: false };

  user = {
    id: from.id,
    username: from.username || null,
    first_name: from.first_name || "",
    balance: 0,
    banned: false,
    test_used: 0,
    joined_channels_ok: false,
    rules_accepted: false,
    phone: null,
    phone_verified: false,
    referred_by: referredBy || null,
    ref_count: 0,
    ref_earnings: 0,
    created_at: Date.now(),
    transactions: [],
  };
  await saveUser(kv, user);
  await addToIndex(kv, "index:users", from.id);
  if (user.username) await kv.put(`index:username:${user.username.toLowerCase()}`, String(user.id));

  const stats = await getStats(kv);
  stats.total_users += 1;
  stats.today_users_date = todayKey();
  await saveStats(kv, stats);

  if (referredBy) {
    const refUser = await getUser(kv, referredBy);
    if (refUser && refUser.id !== from.id) {
      refUser.ref_count += 1;
      await saveUser(kv, refUser);
    }
  }

  return { user, isNew: true };
}

export async function addTransaction(kv, userId, tx) {
  const user = await getUser(kv, userId);
  if (!user) return;
  const before = user.balance;
  user.balance += tx.amount;
  user.transactions.unshift({
    ...tx,
    balance_before: before,
    balance_after: user.balance,
    at: Date.now(),
  });
  if (user.transactions.length > 100) user.transactions.length = 100;
  await saveUser(kv, user);
  return user;
}

export async function findUserByUsername(kv, username) {
  const clean = username.replace(/^@/, "").toLowerCase();
  const id = await kv.get(`index:username:${clean}`);
  return id ? getUser(kv, parseInt(id, 10)) : null;
}

// ---------- generic index arrays ----------

export async function getIndex(kv, key) {
  return getJSON(kv, key, []);
}

export async function addToIndex(kv, key, id) {
  const idx = await getIndex(kv, key);
  if (!idx.includes(id)) {
    idx.push(id);
    await putJSON(kv, key, idx);
  }
}

export async function removeFromIndex(kv, key, id) {
  const idx = await getIndex(kv, key);
  const next = idx.filter((x) => x !== id);
  await putJSON(kv, key, next);
}

// ---------- settings ----------

const DEFAULT_SETTINGS = {
  min_charge: 10000,
  ref_reward_percent: 10,
  test_count: 1,
  test_volume_gb: 1,
  test_duration_days: 1,
  card_number: "0000-0000-0000-0000",
  card_holder: "-",
  online_gateway_enabled: false,
  // Master on/off switch for the whole bot, controlled from the admin panel
  // (⚙️ تنظیمات > 🔌 روشن/خاموش ربات). While false, only admins can use the
  // bot — everyone else gets texts.bot_off. See src/lib/styles.js /
  // src/index.js for where this is enforced.
  bot_enabled: true,
  support_id: "@support",
  report_channel_id: null,
  log_channel_id: null,
  log_topics: {},
  // Per-button color overrides, keyed by callback_data (or a callback_data
  // *prefix* for buttons whose data carries a dynamic id, e.g. "buy:prod").
  // "__back__" is a special key that colors every "⬅️ بازگشت" button at
  // once, since its callback_data is the target route and differs per
  // screen. Populated/edited entirely from the admin panel
  // (⚙️ تنظیمات > 🎨 رنگ دکمه‌ها) — see src/lib/buttonStyleRegistry.js for
  // the full catalog of colorable buttons and src/lib/styles.js for how a
  // button's data is resolved to a color at render time.
  button_styles: {
    "confirm:yes": "success",
    "confirm:no": "danger",
  },
  emojis: {},
  support_ai_enabled: true,
  support_ai_provider: "groq",
  support_ai_model: "openai/gpt-oss-120b",
  support_ai_base_url: "https://api.groq.com/openai/v1",
  receipt_ai_enabled: false,
  receipt_ai_provider: "groq",
  receipt_ai_model: "qwen/qwen3.8-27b",
  receipt_ai_base_url: "https://api.groq.com/openai/v1",
  llm7_api_key: "",
  groq_api_key: "",
  ai_system_prompt: "You are the support assistant for a Telegram VPN shop. Answer briefly, accurately and politely in Persian. Never invent payment status or promise a service.",
  receipt_strictness: "strict",
  auto_clean: false,
  backup_enabled: true,
  expiry_warning_hours: 24,
  menu_order: ["test","buy","invite","wallet","services","support"],
  features: {
    buy: true, test: true, wallet: true, services: true, support: true,
    faq: true, referral: true, renewal: true, custom_volume: true,
    extra_volume: true, extra_days: true, card_to_card: true, online_gateway: true,
    broadcast: true, discounts: true, manual_sales: true
  },
  custom_volume: {
    enabled: true, base_volume_gb: 10, base_duration_days: 30, base_price: 30000,
    extra_gb_price: 3000, extra_day_price: 1000, min_volume_gb: 1, max_volume_gb: 1000,
    min_duration_days: 1, max_duration_days: 365, source: "panel", panel_id: null, profile_id: null,
    inventory_fallback: true
  },
  extra_volume: { enabled: true, min_gb: 1, max_gb: 500, price_per_gb: 3000 },
  extra_days: { enabled: true, min_days: 1, max_days: 365, price_per_day: 1000 },
  rate_limits: { test_per_hour: 3, receipt_per_hour: 5 },
  manual_sales_enabled: true,
  card_last4_required: true,
  receipt_auto_reject_unrelated: true,
  receipt_review_on_uncertain: true,
  
};

export async function getSettings(kv) {
  // Merge (not replace) so a bot that already has config:settings saved from
  // before still picks up any *new* default keys added later (bot_enabled,
  // new button_styles entries, ...) instead of getting `undefined` for them.
  const stored = await getJSON(kv, "config:settings", null);
  if (!stored) return { ...DEFAULT_SETTINGS };
  const merged = {
    ...DEFAULT_SETTINGS,
    ...stored,
    button_styles: { ...DEFAULT_SETTINGS.button_styles, ...(stored.button_styles || {}) },
    emojis: { ...DEFAULT_SETTINGS.emojis, ...(stored.emojis || {}) },
  };

  // Migrate the old receipt Vision model automatically. It was deprecated by
  // Groq in July 2026, so an existing KV config must not keep selecting it.
  const deprecatedReceiptModels = new Set([
    "meta-llama/llama-4-scout-17b-16e-instruct",
    "qwen/qwen3.6-27b",
  ]);
  let migrated = false;
  if (deprecatedReceiptModels.has(merged.receipt_ai_model)) {
    merged.receipt_ai_model = DEFAULT_SETTINGS.receipt_ai_model;
    migrated = true;
  }
  // This release introduces the online AI support as a first-class user feature.
  // If a Groq key already exists and the setting was never intentionally configured,
  // enable it automatically so existing deployments do not need a manual toggle.
  if (merged.groq_api_key && stored.support_ai_enabled === false) {
    merged.support_ai_enabled = true;
    migrated = true;
  }
  if (migrated) {
    await putJSON(kv, "config:settings", merged);
  }

  return merged;
}

export async function saveSettings(kv, settings) {
  await putJSON(kv, "config:settings", settings);
}

// Every message the bot sends to a *regular user* (not admin-only technical
// messages) is a key here, editable from ⚙️ تنظیمات > 📝 متن‌های ربات.
// Some carry {placeholder} tokens filled in at send time via render() below
// — keep those tokens when editing the text, or the value just won't be
// substituted.
const DEFAULT_TEXTS = {
  // ---- onboarding / forced join / rules / phone ----
  welcome: "🎃 سلام کاربر عزیز\nبخش مورد نظر خود را انتخاب کنید:",
  menu_buy: "💥 خرید اشتراک", menu_wallet: "💸 کیف پول", menu_services: "🔍 سرویس‌های من",
  menu_test: "🦠 اکانت تست", menu_referral: "🗣 دعوت دوستان", menu_support: "☎️ پشتیبانی آنلاین", menu_faq: "❓ راهنما و سوالات متداول",
  join_required: "برای استفاده از ربات، ابتدا در کانال‌های زیر عضو شوید:",
  rules: "📜 <b>قوانین استفاده از ربات</b>\n\nبا زدن دکمه «می‌پذیرم» قوانین ربات را می‌پذیرید و می‌توانید ادامه دهید.",
  phone_request: "📱 برای احراز هویت، لطفاً با دکمه زیر شماره تلفن تلگرام خودتان را ارسال کنید.",
  phone_verified: "✅ شماره تلفن شما با موفقیت تأیید شد.",
  phone_invalid: "❌ لطفاً شماره تلفن خودِ خودتان را با همان دکمه ارسال کنید.",
  banned: "⛔ دسترسی شما به ربات مسدود شده است.",
  bot_off: "🔴 ربات در حال حاضر خاموش است. لطفاً بعداً مراجعه کنید.",

  // ---- test account ----
  test_menu: "🔍 حجم تست: {volume}MB\n〽️ مدت تست: {days} روز",
  test_quota_over: "❌ سهمیه تست شما تمام شده است.",
  test_unavailable: "⚠️ در حال حاضر امکان ساخت اکانت تست وجود ندارد. بعداً تلاش کنید.",
  test_creating: "⏳ در حال ساخت اکانت تست...",
  test_success: "✅ اکانت تست شما ساخته شد.\n\n🗣 نام کاربری: <code>{username}</code>\n🔍 حجم: {volume}GB\n〽️ مدت: {days} روز",
  test_error: "❌ خطا در ساخت اکانت تست. لطفاً بعداً دوباره تلاش کنید یا با پشتیبانی تماس بگیرید.",

  // ---- purchase flow ----
  buy_no_categories: "در حال حاضر محصولی برای فروش وجود ندارد.",
  buy_pick_category: "💥 یک دسته‌بندی را انتخاب کنید:",
  buy_no_products: "محصولی در این دسته موجود نیست.",
  buy_pick_product: "یک محصول را انتخاب کنید:",
  buy_product_gone: "این محصول دیگر موجود نیست.",
  buy_discount_prompt: "🎟 کد تخفیف خود را ارسال کنید:",
  buy_discount_invalid: "❌ کد تخفیف نامعتبر یا منقضی شده است.",
  buy_insufficient_balance: "❌ موجودی کیف پول کافی نیست.",
  buy_success_processing: "✅ خرید با موفقیت انجام شد.\n\n⏳ در حال ساخت سرویس...",
  buy_service_ready: "📦 سرویس شما ساخته شد!\n\n👤 نام کاربری: <code>{username}</code>\n📦 حجم: {volume}GB\n⏳ انقضا: {expires}",
  buy_provision_failed_no_panel: "⚠️ خرید ثبت شد اما پنل/پروفایل این محصول تنظیم نشده. پشتیبانی به‌زودی سرویس شما را فعال می‌کند.",
  buy_provision_failed: "⚠️ پرداخت شما ثبت شد اما در ساخت سرویس مشکلی پیش آمد. پشتیبانی به‌زودی پیگیری می‌کند.",

  // ---- custom volume / add-ons ----
  custom_volume_title: "🎛 <b>حجم دلخواه</b>",
  custom_volume_description: "حجم و مدت موردنظرتان را با دکمه‌های + و − انتخاب کنید.",
  custom_volume_price: "💰 قیمت نهایی: {price}",
  custom_volume_summary: "📦 حجم: {volume}GB\n⏳ مدت: {days} روز\n💰 قیمت: {price}",
  custom_volume_unavailable: "❌ حجم دلخواه در حال حاضر فعال نیست.",
  extra_volume_title: "➕ افزایش حجم سرویس",
  extra_days_title: "⏳ افزایش مدت سرویس",
  extra_purchase_summary: "📦 افزایش: {amount}\n💰 هزینه: {price}",
  // ---- wallet ----
  wallet_charge_method_prompt: "روش شارژ کیف پول را انتخاب کنید:",
  wallet_gateway_not_ready: "🌐 پرداخت آنلاین هنوز به درگاه واقعی متصل نشده است. فعلاً از کارت‌به‌کارت استفاده کنید.",
  wallet_custom_amount_prompt: "💰 مبلغ دلخواه خود را به تومان وارد کنید (فقط عدد):",
  wallet_custom_amount_invalid: "❌ مبلغ نامعتبر است. حداقل مبلغ شارژ {min} می‌باشد.",
  wallet_receipt_prompt: "📸 لطفاً تصویر رسید پرداخت را ارسال کنید.",
  wallet_receipt_need_photo: "📸 لطفاً یک تصویر ارسال کنید.",
  wallet_receipt_received: "⏳ رسید شما برای بررسی ارسال شد.",
  wallet_no_transactions: "تراکنشی ثبت نشده است.",

  // ---- services ----
  services_empty: "شما هنوز سرویسی ندارید.",
  services_not_found: "سرویس یافت نشد.",
  services_expired_note: "🔴 این سرویس منقضی شده است.",
  services_renew_unavailable: "❌ امکان تمدید خودکار این سرویس وجود ندارد. با پشتیبانی تماس بگیرید.",
  service_expired: "🔴 سرویس #{id} شما منقضی شد.",
  service_expiry_warning: "⚠️ سرویس #{id} شما حدود {hours} ساعت دیگر منقضی می‌شود.",
  service_volume_80: "⚠️ حجم سرویس #{id} شما به ۸۰٪ رسیده است.\n📈 باقی‌مانده: {remaining}GB",
  service_volume_100: "🚨 حجم سرویس #{id} شما تمام شده است.",

  // ---- support / tickets / faq ----
  support_menu: "☎️ بخش پشتیبانی را انتخاب کنید:",
  support_ticket_prompt: "☎️ پیام خود را برای پشتیبانی ارسال کنید:",
  support_ticket_sent: "✅ پیام شما برای پشتیبانی ارسال شد.",
  support_reply_prefix: "☎️ پاسخ پشتیبانی:",
  faq_empty: "در حال حاضر سوالی ثبت نشده است.",
};

export async function getTexts(kv) {
  // Same reasoning as getSettings(): merge over defaults so new text keys
  // added after a bot already has config:texts saved don't come back
  // `undefined` (which silently breaks any message that uses them).
  const stored = await getJSON(kv, "config:texts", null);
  if (!stored) return { ...DEFAULT_TEXTS };
  return { ...DEFAULT_TEXTS, ...stored };
}

export async function saveTexts(kv, texts) {
  await putJSON(kv, "config:texts", texts);
}

// Fills {placeholder} tokens in an editable text with values, e.g.
// render(texts.test_success, { username: "u1", volume: 10, days: 30 }).
// Unknown tokens are left as-is instead of turning into "undefined".
export function render(str, vars = {}) {
  return String(str || "").replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined && vars[k] !== null ? vars[k] : m));
}

// ---------- FAQ (سوالات متداول) ----------

const DEFAULT_FAQS = [
  { id: 1, q: "نحوه اتصال چگونه است؟", a: "لینک Subscription خود را در اپلیکیشن کلاینت (v2rayNG، Streisand، ...) وارد کنید." },
  { id: 2, q: "حجم سرویس چگونه محاسبه می‌شود؟", a: "مجموع آپلود و دانلود شما از سرویس کسر می‌شود." },
  { id: 3, q: "Subscription چیست؟", a: "لینکی که تمام کانفیگ‌های سرویس شما را یکجا در اختیار کلاینت قرار می‌دهد." },
  { id: 4, q: "چرا سرویس وصل نمی‌شود؟", a: "از منقضی نشدن تاریخ و اتمام حجم سرویس مطمئن شوید و اتصال اینترنت خود را بررسی کنید." },
];

export async function getFaqs(kv) {
  return getJSON(kv, "config:faqs", DEFAULT_FAQS);
}

export async function saveFaqs(kv, faqs) {
  await putJSON(kv, "config:faqs", faqs);
}

export async function addFaq(kv, q, a) {
  const faqs = await getFaqs(kv);
  // Not using nextId()/seq:faqs here on purpose: the default seed FAQs
  // (ids 1-4) are never persisted through that counter, so deriving the
  // next id from the current list avoids colliding with them.
  const id = faqs.reduce((max, f) => Math.max(max, f.id), 0) + 1;
  faqs.push({ id, q, a });
  await saveFaqs(kv, faqs);
  return id;
}

// ---------- forced-join channels ----------

export async function getChannels(kv) {
  return getJSON(kv, "config:channels", []);
}

export async function saveChannels(kv, channels) {
  await putJSON(kv, "config:channels", channels);
}

// ---------- categories ----------

export async function getCategories(kv) {
  return getJSON(kv, "config:categories", []);
}

export async function saveCategories(kv, categories) {
  await putJSON(kv, "config:categories", categories);
}

// ---------- products ----------

export async function getProductIndex(kv) {
  return getIndex(kv, "index:products");
}

export async function getProduct(kv, id) {
  return getJSON(kv, `product:${id}`, null);
}

export async function saveProduct(kv, product) {
  if (!product.id) product.id = await nextId(kv, "seq:products");
  await putJSON(kv, `product:${product.id}`, product);
  await addToIndex(kv, "index:products", product.id);
  return product;
}

export async function deleteProduct(kv, id) {
  await kv.delete(`product:${id}`);
  await removeFromIndex(kv, "index:products", id);
}

export async function listProductsByCategory(kv, categoryId) {
  const ids = await getProductIndex(kv);
  const products = await Promise.all(ids.map((id) => getProduct(kv, id)));
  return products.filter((p) => p && p.category_id === categoryId);
}

// ---------- panels ----------

export async function getPanelIndex(kv) {
  return getIndex(kv, "index:panels");
}

export async function getPanel(kv, id) {
  return getJSON(kv, `panel:${id}`, null);
}

export async function savePanel(kv, panel) {
  if (!panel.id) panel.id = await nextId(kv, "seq:panels");
  await putJSON(kv, `panel:${panel.id}`, panel);
  await addToIndex(kv, "index:panels", panel.id);
  return panel;
}

export async function deletePanel(kv, id) {
  await kv.delete(`panel:${id}`);
  await removeFromIndex(kv, "index:panels", id);
}

// ---------- profiles (per panel) ----------

export async function getProfiles(kv, panelId) {
  return getJSON(kv, `profiles:${panelId}`, []);
}

export async function saveProfiles(kv, panelId, profiles) {
  await putJSON(kv, `profiles:${panelId}`, profiles);
}

// ---------- discount codes ----------

export async function getDiscount(kv, code) {
  return getJSON(kv, `discount:${code.toUpperCase()}`, null);
}

export async function saveDiscount(kv, discount) {
  discount.code = discount.code.toUpperCase();
  await putJSON(kv, `discount:${discount.code}`, discount);
  await addToIndex(kv, "index:discounts", discount.code);
}

export async function deleteDiscount(kv, code) {
  await kv.delete(`discount:${code.toUpperCase()}`);
  await removeFromIndex(kv, "index:discounts", code.toUpperCase());
}

export async function getDiscountIndex(kv) {
  return getIndex(kv, "index:discounts");
}

// ---------- orders ----------

export async function createOrder(kv, order) {
  order.id = await nextId(kv, "seq:orders");
  order.created_at = Date.now();
  await putJSON(kv, `order:${order.id}`, order);
  await addToIndex(kv, `index:orders:user:${order.user_id}`, order.id);
  await addToIndex(kv, "index:orders:all", order.id);
  return order;
}

export async function getOrder(kv, id) {
  return getJSON(kv, `order:${id}`, null);
}

export async function saveOrder(kv, order) {
  await putJSON(kv, `order:${order.id}`, order);
}

export async function getUserOrders(kv, userId) {
  const ids = await getIndex(kv, `index:orders:user:${userId}`);
  return Promise.all(ids.map((id) => getOrder(kv, id)));
}

// ---------- services ----------

export async function createService(kv, service) {
  service.id = await nextId(kv, "seq:services");
  service.created_at = Date.now();
  await putJSON(kv, `service:${service.id}`, service);
  await addToIndex(kv, `index:services:user:${service.user_id}`, service.id);
  await addToIndex(kv, "index:services:active", service.id);
  return service;
}

export async function getService(kv, id) {
  return getJSON(kv, `service:${id}`, null);
}

export async function saveService(kv, service) {
  await putJSON(kv, `service:${service.id}`, service);
}

export async function getUserServices(kv, userId) {
  const ids = await getIndex(kv, `index:services:user:${userId}`);
  return Promise.all(ids.map((id) => getService(kv, id)));
}

export async function getActiveServiceIndex(kv) {
  return getIndex(kv, "index:services:active");
}

// ---------- payments (card-to-card / gateway) ----------

export async function createPayment(kv, payment) {
  payment.id = await nextId(kv, "seq:payments");
  payment.created_at = Date.now();
  payment.status = "pending";
  await putJSON(kv, `payment:${payment.id}`, payment);
  await addToIndex(kv, "index:payments:pending", payment.id);
  return payment;
}

export async function getPayment(kv, id) {
  return getJSON(kv, `payment:${id}`, null);
}

export async function savePayment(kv, payment) {
  await putJSON(kv, `payment:${payment.id}`, payment);
}

export async function resolvePayment(kv, id) {
  await removeFromIndex(kv, "index:payments:pending", id);
}

export async function getPendingPayments(kv) {
  const ids = await getIndex(kv, "index:payments:pending");
  return Promise.all(ids.map((id) => getPayment(kv, id)));
}

// Receipt fingerprints are global across users. This prevents the same
// uploaded image from being accepted more than once, even when a new payment
// record is created for the second upload.
export async function getPaymentByReceiptHash(kv, hash) {
  if (!hash) return null;
  const id = await kv.get(`payment:receipt_hash:${hash}`);
  return id ? getPayment(kv, Number(id)) : null;
}

export async function claimReceiptHash(kv, hash, paymentId) {
  if (!hash) return false;
  const key = `payment:receipt_hash:${hash}`;
  const existing = await kv.get(key);
  if (existing && String(existing) !== String(paymentId)) return false;
  await kv.put(key, String(paymentId));
  return true;
}

export async function getPaymentByReceiptFileId(kv, fileId) {
  if (!fileId) return null;
  const id = await kv.get(`payment:receipt_file:${fileId}`);
  return id ? getPayment(kv, Number(id)) : null;
}

export async function claimReceiptFileId(kv, fileId, paymentId) {
  if (!fileId) return false;
  const key = `payment:receipt_file:${fileId}`;
  const existing = await kv.get(key);
  if (existing && String(existing) !== String(paymentId)) return false;
  await kv.put(key, String(paymentId));
  return true;
}

export async function getPaymentByReceiptReference(kv, reference) {
  if (!reference) return null;
  const normalized = String(reference).trim().toLowerCase();
  if (!normalized) return null;
  const id = await kv.get(`payment:receipt_ref:${normalized}`);
  return id ? getPayment(kv, Number(id)) : null;
}

export async function claimReceiptReference(kv, reference, paymentId) {
  if (!reference) return false;
  const normalized = String(reference).trim().toLowerCase();
  if (!normalized) return false;
  const key = `payment:receipt_ref:${normalized}`;
  const existing = await kv.get(key);
  if (existing && String(existing) !== String(paymentId)) return false;
  await kv.put(key, String(paymentId));
  return true;
}

export async function isPaymentCharged(kv, paymentId) {
  return (await kv.get(`payment:charged:${paymentId}`)) === "1";
}

export async function claimPaymentCharge(kv, paymentId) {
  const key = `payment:charged:${paymentId}`;
  const existing = await kv.get(key);
  if (existing === "1") return false;
  await kv.put(key, "1");
  return true;
}

// ---------- support tickets ----------

export async function createTicket(kv, ticket) {
  ticket.id = await nextId(kv, "seq:tickets");
  ticket.created_at = Date.now();
  ticket.status = "open";
  ticket.messages = [{ from: "user", text: ticket.first_message, at: Date.now() }];
  await putJSON(kv, `ticket:${ticket.id}`, ticket);
  await addToIndex(kv, `index:tickets:user:${ticket.user_id}`, ticket.id);
  await addToIndex(kv, "index:tickets:open", ticket.id);
  return ticket;
}

export async function getTicket(kv, id) {
  return getJSON(kv, `ticket:${id}`, null);
}

export async function saveTicket(kv, ticket) {
  await putJSON(kv, `ticket:${ticket.id}`, ticket);
}

export async function getOpenTickets(kv) {
  const ids = await getIndex(kv, "index:tickets:open");
  return Promise.all(ids.map((id) => getTicket(kv, id)));
}

export async function getUserOpenTicket(kv, userId) {
  const ids = await getIndex(kv, `index:tickets:user:${userId}`);
  const tickets = await Promise.all(ids.map((id) => getTicket(kv, id)));
  return tickets.find((t) => t && t.status !== "closed") || null;
}

// ---------- admins ----------

export async function getAdmins(kv) {
  return getJSON(kv, "config:admins", []);
}

export async function saveAdmins(kv, admins) {
  await putJSON(kv, "config:admins", admins);
}

export async function getAdminRole(kv, userId) {
  const admins = await getAdmins(kv);
  const a = admins.find((x) => x.id === userId);
  return a ? a.role : null;
}

// ---------- stats ----------

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

export async function getStats(kv) {
  return getJSON(kv, "stats:global", {
    total_users: 0,
    today_users_date: todayKey(),
    today_users: 0,
    total_orders: 0,
    total_sales: 0,
    total_charge: 0,
    tests_used: 0,
    referrals: 0,
  });
}

export async function saveStats(kv, stats) {
  await putJSON(kv, "stats:global", stats);
}

// ---------- audit log ----------

export async function logAction(kv, adminId, action, target) {
  const key = `audit:${Date.now()}:${adminId}`;
  await putJSON(kv, key, { admin_id: adminId, action, target, at: Date.now() });
  await addToIndex(kv, "index:audit", key);
  const idx = await getIndex(kv, "index:audit");
  if (idx.length > 500) {
    const removed = idx.splice(0, idx.length - 500);
    await putJSON(kv, "index:audit", idx);
    for (const k of removed) await kv.delete(k);
  }
}

export async function getRecentAudit(kv, limit = 20) {
  const idx = await getIndex(kv, "index:audit");
  const recent = idx.slice(-limit).reverse();
  return Promise.all(recent.map((k) => getJSON(kv, k, null)));
}


// ---------- backup ----------
export async function exportKVBackup(kv) {
  const out = { version: 1, exported_at: new Date().toISOString(), keys: {} };
  let cursor;
  do {
    const page = await kv.list({ cursor, limit: 1000 });
    for (const item of page.keys || []) {
      const value = await kv.get(item.name);
      out.keys[item.name] = value;
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return out;
}

// ---------- feature flags / inventory ----------
export async function isFeatureEnabled(kv, key) {
  const settings = await getSettings(kv);
  return settings.features?.[key] !== false;
}

export async function getInventoryIndex(kv) {
  return getIndex(kv, "index:inventory");
}
export async function getInventoryItem(kv, id) {
  return getJSON(kv, `inventory:${id}`, null);
}
export async function saveInventoryItem(kv, item) {
  if (!item.id) item.id = await nextId(kv, "seq:inventory");
  await putJSON(kv, `inventory:${item.id}`, item);
  await addToIndex(kv, "index:inventory", item.id);
  return item;
}
export async function deleteInventoryItem(kv, id) {
  await kv.delete(`inventory:${id}`);
  await removeFromIndex(kv, "index:inventory", id);
}
export async function listInventory(kv) {
  const ids = await getInventoryIndex(kv);
  return (await Promise.all(ids.map((id) => getInventoryItem(kv, id)))).filter(Boolean);
}
export async function claimInventoryItem(kv, id) {
  const item = await getInventoryItem(kv, id);
  if (!item || item.status === "sold") return null;
  item.status = "sold";
  item.claimed_at = Date.now();
  await putJSON(kv, `inventory:${id}`, item);
  return item;
}

export async function addTransactionSafe(env, userId, tx) {
  const { withUserLock } = await import("./locks.js");
  return withUserLock(env, userId, () => addTransaction(env.BOT_KV, userId, tx));
}
export async function claimInventoryItemSafe(env, id) {
  const { withSequenceLock } = await import("./locks.js");
  return withSequenceLock(env, `inventory:${id}`, () => claimInventoryItem(env.BOT_KV, id));
}
export async function claimReceiptHashSafe(env, hash, paymentId) { const { withSequenceLock } = await import("./locks.js"); return withSequenceLock(env, `receipt-hash:${hash}`, () => claimReceiptHash(env.BOT_KV, hash, paymentId)); }
export async function claimReceiptFileIdSafe(env, fileId, paymentId) { const { withSequenceLock } = await import("./locks.js"); return withSequenceLock(env, `receipt-file:${fileId}`, () => claimReceiptFileId(env.BOT_KV, fileId, paymentId)); }
export async function claimReceiptReferenceSafe(env, ref, paymentId) { const { withSequenceLock } = await import("./locks.js"); return withSequenceLock(env, `receipt-ref:${ref}`, () => claimReceiptReference(env.BOT_KV, ref, paymentId)); }
