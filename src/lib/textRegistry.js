// Full catalog of every editable bot text (see DEFAULT_TEXTS in
// src/lib/kv.js for the actual default values), grouped into categories
// for the admin UI (⚙️ تنظیمات > 📝 متن‌های ربات).

export const TEXT_CATEGORIES = [
  {
    label: "🏠 ورود / قوانین / شماره تلفن",
    items: [
      { key: "welcome", label: "🎃 پیام خوش‌آمدگویی (منوی اصلی)" },
      { key: "join_required", label: "📢 متن عضویت اجباری" },
      { key: "rules", label: "📜 متن قوانین" },
      { key: "phone_request", label: "📱 متن درخواست شماره تلفن" },
      { key: "phone_verified", label: "✅ متن تأیید شماره تلفن" },
      { key: "phone_invalid", label: "❌ شماره تلفن نامعتبر" },
      { key: "banned", label: "⛔ کاربر مسدود شده" },
      { key: "bot_off", label: "🔴 ربات خاموش است" },
    ],
  },
  {
    label: "🦠 اکانت تست",
    items: [
      { key: "test_menu", label: "منوی اکانت تست (شامل {volume} و {days})" },
      { key: "test_quota_over", label: "سهمیه تست تمام شده" },
      { key: "test_unavailable", label: "اکانت تست موقتاً در دسترس نیست" },
      { key: "test_creating", label: "در حال ساخت اکانت تست" },
      { key: "test_success", label: "موفقیت (شامل {username} {volume} {days})" },
      { key: "test_error", label: "خطا در ساخت اکانت تست" },
    ],
  },
  {
    label: "💥 خرید اشتراک",
    items: [
      { key: "buy_no_categories", label: "هیچ محصولی موجود نیست" },
      { key: "buy_pick_category", label: "انتخاب دسته‌بندی" },
      { key: "buy_no_products", label: "محصولی در این دسته نیست" },
      { key: "buy_pick_product", label: "انتخاب محصول" },
      { key: "buy_product_gone", label: "محصول دیگر موجود نیست" },
      { key: "buy_discount_prompt", label: "درخواست کد تخفیف" },
      { key: "buy_discount_invalid", label: "کد تخفیف نامعتبر" },
      { key: "buy_insufficient_balance", label: "موجودی ناکافی" },
      { key: "buy_success_processing", label: "خرید موفق - در حال ساخت سرویس" },
      { key: "buy_service_ready", label: "سرویس آماده شد (شامل {username} {volume} {expires})" },
      { key: "buy_provision_failed_no_panel", label: "خرید ثبت شد ولی پنل تنظیم نشده" },
      { key: "buy_provision_failed", label: "خطا در ساخت سرویس بعد از پرداخت" },
    ],
  },
  {
    label: "💸 کیف پول",
    items: [
      { key: "wallet_charge_method_prompt", label: "انتخاب روش شارژ" },
      { key: "wallet_gateway_not_ready", label: "درگاه آنلاین متصل نیست" },
      { key: "wallet_custom_amount_prompt", label: "درخواست مبلغ دلخواه" },
      { key: "wallet_custom_amount_invalid", label: "مبلغ نامعتبر (شامل {min})" },
      { key: "wallet_receipt_prompt", label: "درخواست تصویر رسید" },
      { key: "wallet_receipt_need_photo", label: "باید تصویر ارسال شود" },
      { key: "wallet_receipt_received", label: "رسید دریافت شد" },
      { key: "wallet_no_transactions", label: "تراکنشی ثبت نشده" },
    ],
  },
  {
    label: "🔍 سرویس‌های من",
    items: [
      { key: "services_empty", label: "هیچ سرویسی وجود ندارد" },
      { key: "services_not_found", label: "سرویس یافت نشد" },
      { key: "services_expired_note", label: "یادداشت سرویس منقضی‌شده" },
      { key: "services_renew_unavailable", label: "تمدید خودکار غیرممکن است" },
    ],
  },
  {
    label: "☎️ پشتیبانی و تیکت‌ها",
    items: [
      { key: "support_menu", label: "متن منوی پشتیبانی" },
      { key: "support_ticket_prompt", label: "درخواست پیام تیکت" },
      { key: "support_ticket_sent", label: "تیکت ارسال شد" },
      { key: "support_reply_prefix", label: "پیشوند پاسخ پشتیبانی" },
      { key: "faq_empty", label: "سوالی ثبت نشده" },
    ],
  },
];
