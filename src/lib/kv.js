// All persistent state lives in Cloudflare KV (BOT_KV binding).
// KV has no querying, so every "list" (users, products, orders...) is kept
// as a small index array under one key, plus one key per record.
// KV is eventually-consistent and has no transactions: fine for a shop bot
// at normal traffic, but don't rely on it for high-frequency concurrent
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
    referred_by: referredBy || null,
    ref_count: 0,
    ref_earnings: 0,
    created_at: Date.now(),
    transactions: [], // capped list, most recent first
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
  user.balance += tx.amount; // amount can be negative (purchase) or positive (charge/refund/reward)
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
  support_id: "@support",
};

export async function getSettings(kv) {
  return getJSON(kv, "config:settings", DEFAULT_SETTINGS);
}

export async function saveSettings(kv, settings) {
  await putJSON(kv, "config:settings", settings);
}

const DEFAULT_TEXTS = {
  welcome: "🎃 سلام کاربر عزیز\nبخش مورد نظر خود را انتخاب کنید:",
  join_required: "برای استفاده از ربات، ابتدا در کانال‌های زیر عضو شوید:",
  support_menu: "بخش پشتیبانی را انتخاب کنید:",
};

export async function getTexts(kv) {
  return getJSON(kv, "config:texts", DEFAULT_TEXTS);
}

export async function saveTexts(kv, texts) {
  await putJSON(kv, "config:texts", texts);
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
  return getJSON(kv, "config:admins", []); // [{id, role: 'owner'|'manager'|'support'}]
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
