// Full catalog of every colorable button in the bot, grouped into
// categories for the admin UI (⚙️ تنظیمات > 🎨 رنگ دکمه‌ها).
//
// Each item's `key` is either:
//  - the exact callback_data of a static button (e.g. "menu:test"), or
//  - a callback_data *prefix* for buttons whose data carries a dynamic id
//    (e.g. "buy:prod" matches "buy:prod:42", "buy:prod:99", ...) — every
//    button sharing that prefix gets the same color, which is the only
//    sane option for per-item buttons (products, tickets, users, ...).
//  - "__back__", a virtual key that colors every "⬅️ بازگشت" button at
//    once (its real callback_data is whatever screen it goes back to, so
//    it can't be matched by prefix).
//
// See src/lib/styles.js for how a button's data is resolved against this
// through settings.button_styles, and src/handlers/admin/settings.js for
// the admin UI built from this file.

export const BUTTON_STYLE_CATEGORIES = [
  {
    label: "🏠 ورود و منوی اصلی",
    items: [
      { key: "join:check", label: "✅ بررسی عضویت" },
      { key: "rules:accept", label: "✅ پذیرش قوانین" },
      { key: "menu:test", label: "🦠 اکانت تست" },
      { key: "menu:buy", label: "💥 خرید اشتراک" },
      { key: "menu:invite", label: "🗣 دعوت دوستان" },
      { key: "menu:wallet", label: "💸 کیف پول" },
      { key: "menu:services", label: "🔍 سرویس‌های من" },
      { key: "menu:support", label: "☎️ پشتیبانی" },
    ],
  },
  {
    label: "🦠 اکانت تست",
    items: [
      { key: "test:main", label: "ورود به بخش تست" },
      { key: "test:get", label: "🎁 دریافت اکانت تست" },
    ],
  },
  {
    label: "💥 خرید اشتراک",
    items: [
      { key: "buy:categories", label: "لیست دسته‌بندی‌ها" },
      { key: "buy:cat", label: "📂 انتخاب دسته‌بندی" },
      { key: "buy:prod", label: "🛍 انتخاب محصول" },
      { key: "buy:discount", label: "🎟 وارد کردن کد تخفیف" },
      { key: "buy:pay", label: "💳 پرداخت از کیف پول" },
      { key: "buy:confirm", label: "✅ تأیید خرید" },
    ],
  },
  {
    label: "💸 کیف پول",
    items: [
      { key: "wallet:main", label: "کیف پول" },
      { key: "wallet:charge", label: "💳 شارژ کیف پول" },
      { key: "wallet:charge:card", label: "💳 کارت‌به‌کارت" },
      { key: "wallet:charge:gateway", label: "🌐 پرداخت آنلاین" },
      { key: "wallet:amt", label: "💰 مبالغ پیشنهادی" },
      { key: "wallet:tx", label: "📜 تراکنش‌ها" },
    ],
  },
  {
    label: "🔍 سرویس‌های من",
    items: [
      { key: "svc:list", label: "لیست سرویس‌ها" },
      { key: "svc:view", label: "🔍 مشاهده سرویس" },
      { key: "svc:refresh", label: "🔄 بروزرسانی سرویس" },
      { key: "svc:renew", label: "♻️ تمدید سرویس" },
      { key: "svc:renewconfirm", label: "✅ تأیید و پرداخت تمدید" },
    ],
  },
  {
    label: "☎️ پشتیبانی",
    items: [
      { key: "support:main", label: "منوی پشتیبانی" },
      { key: "support:faq", label: "❓ سوالات متداول" },
      { key: "support:ticket", label: "👨‍💻 پشتیبانی آنلاین" },
    ],
  },
  {
    label: "🗣 دعوت دوستان",
    items: [
      { key: "invite:main", label: "دعوت دوستان" },
      { key: "invite:stats", label: "📊 آمار دعوت‌ها" },
    ],
  },
  {
    label: "🔘 دکمه‌های عمومی",
    items: [
      { key: "__back__", label: "⬅️ دکمه بازگشت (همه‌جا)" },
      { key: "confirm:yes", label: "✅ دکمه تأیید (بله)" },
      { key: "confirm:no", label: "❌ دکمه لغو (خیر)" },
    ],
  },
  {
    label: "🛠 پنل ادمین - منوی اصلی",
    items: [
      { key: "admin:main", label: "بازگشت به پنل مدیریت" },
      { key: "admin:users", label: "👥 کاربران" },
      { key: "admin:products", label: "🛍 محصولات" },
      { key: "admin:categories", label: "📂 دسته‌بندی‌ها" },
      { key: "admin:panels", label: "🖥 پنل‌ها" },
      { key: "admin:profiles", label: "👤 پروفایل‌ها" },
      { key: "admin:payments", label: "💳 پرداخت‌ها" },
      { key: "admin:discounts", label: "🎟 تخفیف‌ها" },
      { key: "admin:wallet", label: "💰 کیف پول" },
      { key: "admin:broadcast", label: "📢 Broadcast" },
      { key: "admin:stats", label: "📊 آمار" },
      { key: "admin:settings", label: "⚙️ تنظیمات" },
      { key: "admin:channels", label: "📢 کانال‌ها" },
      { key: "admin:tickets", label: "💬 پشتیبانی" },
      { key: "admin:audit", label: "📝 گزارش فعالیت" },
      { key: "admin:admins", label: "👨‍💼 ادمین‌ها" },
    ],
  },
  {
    label: "👥 مدیریت کاربران",
    items: [
      { key: "admin:users:search", label: "جستجوی کاربر" },
      { key: "admin:user:card", label: "کارت کاربر" },
      { key: "admin:user:ban", label: "مسدود کردن" },
      { key: "admin:user:unban", label: "رفع مسدودی" },
      { key: "admin:user:resettest", label: "ریست سهمیه تست" },
      { key: "admin:user:credit", label: "افزایش موجودی" },
      { key: "admin:user:debit", label: "کسر موجودی" },
      { key: "admin:user:services", label: "سرویس‌های کاربر" },
      { key: "admin:user:orders", label: "سفارش‌های کاربر" },
    ],
  },
  {
    label: "🛍 مدیریت محصولات",
    items: [
      { key: "admin:prod:add", label: "افزودن محصول" },
      { key: "admin:prod:view", label: "مشاهده محصول" },
      { key: "admin:prod:toggle", label: "فعال/غیرفعال" },
      { key: "admin:prod:delconfirm", label: "تأیید حذف" },
      { key: "admin:prod:delete", label: "حذف محصول" },
      { key: "admin:prod:edit", label: "ویرایش محصول" },
      { key: "admin:prod:editfield", label: "ویرایش فیلد" },
    ],
  },
  {
    label: "📂 دسته‌بندی‌ها",
    items: [
      { key: "admin:cat:add", label: "افزودن دسته" },
      { key: "admin:cat:view", label: "مشاهده دسته" },
      { key: "admin:cat:rename", label: "تغییر نام" },
      { key: "admin:cat:toggle", label: "فعال/غیرفعال" },
      { key: "admin:cat:delete", label: "حذف دسته" },
    ],
  },
  {
    label: "🖥 پنل‌ها",
    items: [
      { key: "admin:panel:add", label: "افزودن پنل" },
      { key: "admin:panel:view", label: "مشاهده پنل" },
      { key: "admin:panel:toggle", label: "فعال/غیرفعال" },
      { key: "admin:panel:delete", label: "حذف پنل" },
      { key: "admin:panel:test", label: "تست اتصال پنل" },
    ],
  },
  {
    label: "👤 پروفایل‌ها",
    items: [
      { key: "admin:profiles:panel", label: "پروفایل‌های پنل" },
      { key: "admin:profile:add", label: "افزودن پروفایل" },
      { key: "admin:profile:view", label: "مشاهده پروفایل" },
      { key: "admin:profile:toggle", label: "فعال/غیرفعال" },
      { key: "admin:profile:delete", label: "حذف پروفایل" },
    ],
  },
  {
    label: "🎟 تخفیف‌ها",
    items: [
      { key: "admin:disc:add", label: "افزودن کد تخفیف" },
      { key: "admin:disc:view", label: "مشاهده کد تخفیف" },
      { key: "admin:disc:toggle", label: "فعال/غیرفعال" },
      { key: "admin:disc:delete", label: "حذف کد تخفیف" },
      { key: "admin:disc:stats", label: "آمار کد تخفیف" },
    ],
  },
  {
    label: "💳 پرداخت‌ها",
    items: [
      { key: "admin:pay:view", label: "مشاهده رسید" },
      { key: "admin:pay:approve", label: "تأیید رسید" },
      { key: "admin:pay:reject", label: "رد رسید" },
    ],
  },
  {
    label: "📢 Broadcast",
    items: [{ key: "admin:bc:target", label: "انتخاب مخاطبین پیام همگانی" }],
  },
  {
    label: "👨‍💼 مدیریت ادمین‌ها",
    items: [
      { key: "admin:admin:add", label: "افزودن ادمین" },
      { key: "admin:admin:view", label: "مشاهده ادمین" },
      { key: "admin:admin:remove", label: "حذف ادمین" },
    ],
  },
  {
    label: "📢 کانال‌های اجباری",
    items: [
      { key: "admin:chan:add", label: "افزودن کانال" },
      { key: "admin:chan:view", label: "مشاهده کانال" },
      { key: "admin:chan:toggle", label: "فعال/غیرفعال" },
      { key: "admin:chan:delete", label: "حذف کانال" },
    ],
  },
  {
    label: "⚙️ تنظیمات",
    items: [
      { key: "admin:set:field", label: "ویرایش یک تنظیم" },
      { key: "admin:set:gateway", label: "وضعیت درگاه آنلاین" },
      { key: "admin:set:power", label: "روشن/خاموش ربات" },
      { key: "admin:set:texts", label: "متن‌های ربات" },
      { key: "admin:set:styles", label: "رنگ دکمه‌ها" },
      { key: "admin:set:log", label: "گروه لاگ" },
      { key: "admin:faq", label: "سوالات متداول" },
    ],
  },
  {
    label: "🎫 تیکت‌های پشتیبانی",
    items: [
      { key: "admin:ticket:view", label: "مشاهده تیکت" },
      { key: "admin:ticket:reply", label: "پاسخ به تیکت" },
      { key: "admin:ticket:close", label: "بستن تیکت" },
    ],
  },
];
