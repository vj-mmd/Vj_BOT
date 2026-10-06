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
  getUser,
  isPaymentCharged,
  claimPaymentCharge,
} from "../../lib/kv.js";
import { reportWalletCharge } from "../../lib/report.js";
import { logWalletCharge, logAIReceiptDecision } from "../../lib/log.js";
import { withUserLock } from "../../lib/locks.js";

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

export async function approvePayment(env, telegram, chatId, adminId, paymentId, automated = false) {
  const kv=env.BOT_KV; const payment=await getPayment(kv,paymentId); if(!payment||payment.status!=="pending")return;
  let approved=false;
  await withUserLock(env,payment.user_id,async()=>{
    const fresh=await getPayment(kv,paymentId); if(!fresh||fresh.status!=="pending")return;
    if(await isPaymentCharged(kv,paymentId))return;
    if(!(await claimPaymentCharge(kv,paymentId)))return;
    fresh.status="approved";fresh.approved_by=automated?"ai":adminId;fresh.approved_at=Date.now();await savePayment(kv,fresh);await resolvePayment(kv,paymentId);
    await addTransaction(kv,fresh.user_id,{type:"charge",amount:fresh.amount,description:fresh.method==="zarinpal"?"شارژ کیف پول (درگاه زرین‌پال)":"شارژ کیف پول (کارت‌به‌کارت)"});
    const stats=await getStats(kv);stats.total_charge+=fresh.amount;await saveStats(kv,stats);await logAction(kv,adminId,"approve_payment",paymentId);approved=true;
    const chargedUser=await getUser(kv,fresh.user_id);if(chargedUser){await reportWalletCharge(env,telegram,chargedUser,fresh.amount);await logWalletCharge(env,telegram,chargedUser,fresh.amount);}
    if(automated) await logAIReceiptDecision(env,telegram,fresh,"approve");
    await telegram.sendMessage(fresh.user_id,automated?`✅ پرداخت شما به‌صورت خودکار تأیید شد.\n💰 ${fresh.amount.toLocaleString("en-US")} تومان به کیف پول اضافه شد.`:`✅ پرداخت تأیید شد.\n💰 ${fresh.amount.toLocaleString("en-US")} تومان به کیف پول اضافه شد.`);
  });
  if(chatId&&!automated&&approved)await telegram.sendMessage(chatId,"✅ پرداخت تأیید و ثبت شد.");
}

export async function rejectPayment(env, telegram, chatId, adminId, paymentId, automated = false) {
  const kv=env.BOT_KV; let rejected=false;
  const p=await getPayment(kv,paymentId); if(!p||p.status!=="pending")return;
  await withUserLock(env,p.user_id,async()=>{const payment=await getPayment(kv,paymentId);if(!payment||payment.status!=="pending")return;payment.status="rejected";payment.rejected_by=automated?"ai":adminId;payment.rejected_at=Date.now();await savePayment(kv,payment);await resolvePayment(kv,paymentId);await logAction(kv,adminId,"reject_payment",paymentId);if(automated)await logAIReceiptDecision(env,telegram,payment,"reject");rejected=true;await telegram.sendMessage(payment.user_id,automated?"❌ رسید پرداخت شما به‌صورت خودکار رد شد؛ اطلاعات رسید با سفارش مطابقت نداشت.":"❌ رسید پرداخت شما رد شد. در صورت اشتباه با پشتیبانی تماس بگیرید.");});
  if(chatId&&!automated&&rejected)await telegram.sendMessage(chatId,"❌ پرداخت رد شد.");
}
