import { keyboard } from "../../lib/keyboards.js";
import {
  getPendingPayments,
  getPayment,
  savePayment,
  resolvePayment,
  addTransaction,
  getStats,
  saveStats,
  logAction,
} from "../../lib/kv.js";

export async function showPaymentsAdmin(env, telegram, chatId, messageId) {
  const pending = await getPendingPayments(env.BOT_KV);
  if (pending.length === 0) {
    await telegram.editOrSend(chatId, messageId, "🟡 پرداخت در انتظاری وجود ندارد.", {
      reply_markup: keyboard([], { back: "admin:main" }),
    });
    return;
  }
  const buttons = pending.map((p) => ({
    text: `#${p.id} — ${p.amount.toLocaleString("en-US")} تومان — کاربر ${p.user_id}`,
    data: `admin:pay:view:${p.id}`,
  }));
  await telegram.editOrSend(chatId, messageId, "💳 <b>پرداخت‌های در انتظار</b>", {
    reply_markup: keyboard(buttons, { perRow: 1, back: "admin:main" }),
  });
}

export async function showPaymentDetail(env, telegram, chatId, messageId, paymentId) {
  const p = await getPayment(env.BOT_KV, paymentId);
  if (!p) return;
  const caption = `🧾 پرداخت #${p.id}\n👤 کاربر: ${p.user_id}\n💰 مبلغ: ${p.amount.toLocaleString("en-US")} تومان\nوضعیت: ${p.status}`;
  if (p.receipt_file_id) {
    await telegram.sendPhoto(chatId, p.receipt_file_id, {
      caption,
      reply_markup: keyboard(
        p.status === "pending"
          ? [
              { text: "✅ تأیید", data: `admin:pay:approve:${p.id}` },
              { text: "❌ رد", data: `admin:pay:reject:${p.id}` },
            ]
          : [],
        { back: "admin:payments" }
      ),
    });
  } else {
    await telegram.editOrSend(chatId, messageId, caption, { reply_markup: keyboard([], { back: "admin:payments" }) });
  }
}

export async function approvePayment(env, telegram, chatId, adminId, paymentId) {
  const kv = env.BOT_KV;
  const payment = await getPayment(kv, paymentId);
  if (!payment || payment.status !== "pending") return;

  payment.status = "approved";
  await savePayment(kv, payment);
  await resolvePayment(kv, paymentId);

  await addTransaction(kv, payment.user_id, {
    type: "charge",
    amount: payment.amount,
    description: "شارژ کیف پول (کارت‌به‌کارت)",
  });

  const stats = await getStats(kv);
  stats.total_charge += payment.amount;
  await saveStats(kv, stats);
  await logAction(kv, adminId, "approve_payment", paymentId);

  await telegram.sendMessage(payment.user_id, `✅ پرداخت تأیید شد.\n💰 مبلغ ${payment.amount.toLocaleString("en-US")} تومان به کیف پول شما اضافه شد.`);
  await telegram.sendMessage(chatId, "✅ پرداخت تأیید و ثبت شد.");
}

export async function rejectPayment(env, telegram, chatId, adminId, paymentId) {
  const kv = env.BOT_KV;
  const payment = await getPayment(kv, paymentId);
  if (!payment || payment.status !== "pending") return;

  payment.status = "rejected";
  await savePayment(kv, payment);
  await resolvePayment(kv, paymentId);
  await logAction(kv, adminId, "reject_payment", paymentId);

  await telegram.sendMessage(payment.user_id, "❌ رسید پرداخت شما رد شد. در صورت اشتباه با پشتیبانی تماس بگیرید.");
  await telegram.sendMessage(chatId, "❌ پرداخت رد شد.");
}
