import { keyboard } from "../../lib/keyboards.js";

// Wallet management is per-user (increase/decrease balance, view tx), which
// already lives in admin/users.js as part of the user card. This screen is
// just the entry point the spec's admin menu expects, pointing at the same
// search flow so there's one code path for balance changes, not two.
export async function showWalletAdminMenu(env, telegram, chatId, messageId) {
  await telegram.editOrSend(
    chatId,
    messageId,
    "💰 <b>مدیریت کیف پول</b>\n\nبرای افزایش/کاهش موجودی یا دیدن تراکنش‌های یک کاربر، ابتدا او را جستجو کنید.",
    { reply_markup: keyboard([{ text: "🔎 جستجوی کاربر", data: "admin:users:search" }], { perRow: 1, back: "admin:main" }) }
  );
}
