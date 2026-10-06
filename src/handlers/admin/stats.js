import { keyboard } from "../../lib/keyboards.js";
import { getStats, getRecentAudit, getActiveServiceIndex, getService, getIndex, getUser, getOrder, getProduct } from "../../lib/kv.js";

export async function showStats(env,telegram,chatId,messageId){
 const st=await getStats(env.BOT_KV), ids=await getActiveServiceIndex(env.BOT_KV), svcs=await Promise.all(ids.map(id=>getService(env.BOT_KV,id))), now=Date.now();
 const oids=await getIndex(env.BOT_KV,"index:orders:all"), orders=(await Promise.all(oids.slice(-500).map(id=>getOrder(env.BOT_KV,id)))).filter(Boolean);
 const userIds=await getIndex(env.BOT_KV,"index:users"); const userOrders={}; for(const o of orders.filter(x=>x.status==="completed")) userOrders[o.user_id]=true; const noPurchase=Math.max(0,userIds.filter(id=>!userOrders[id]).length);
 const dayKey=new Date(now).toISOString().slice(0,10), monthKey=dayKey.slice(0,7); const daily=orders.filter(o=>new Date(o.created_at||0).toISOString().slice(0,10)===dayKey), monthly=orders.filter(o=>new Date(o.created_at||0).toISOString().slice(0,7)===monthKey);
 const dailySales=daily.filter(o=>o.status==="completed").reduce((a,o)=>a+Number(o.price||0),0), monthlySales=monthly.filter(o=>o.status==="completed").reduce((a,o)=>a+Number(o.price||0),0);
 const counts={}; for(const o of orders.filter(x=>x.status==="completed"&&x.product_id)) counts[o.product_id]=(counts[o.product_id]||0)+1; const topId=Object.entries(counts).sort((a,b)=>b[1]-a[1])[0]?.[0]; const top=topId?await getProduct(env.BOT_KV,Number(topId)):null;
 const active=svcs.filter(s=>s&&s.status!=="disabled"&&now<s.expires_at).length,expired=svcs.filter(s=>s&&now>=s.expires_at).length;
 const text=`📊 <b>داشبورد آمار</b>\n\n👥 کاربران: ${st.total_users}\n📦 سرویس فعال: ${active}\n🔴 سرویس منقضی: ${expired}\n🛒 سفارش: ${st.total_orders}\n💰 فروش کل: ${Number(st.total_sales||0).toLocaleString("en-US")} تومان\n💳 شارژ کیف پول: ${Number(st.total_charge||0).toLocaleString("en-US")} تومان\n🎁 تست: ${st.tests_used}`;
 await telegram.editOrSend(chatId,messageId,text,{reply_markup:keyboard([{text:"📤 خروجی CSV کاربران/سفارش‌ها",data:"admin:stats:csv"}],{perRow:1,back:"admin:group:finance"})});
}
export async function exportCSV(env,telegram,chatId,messageId){
 const uids=await getIndex(env.BOT_KV,"index:users"),users=await Promise.all(uids.map(id=>getUser(env.BOT_KV,id))), lines=["type,id,username,balance,created_at"];
 for(const u of users.filter(Boolean))lines.push(`user,${u.id},${JSON.stringify(u.username||"")},${u.balance||0},${u.created_at||""}`);
 const oids=await getIndex(env.BOT_KV,"index:orders:all"),orders=await Promise.all(oids.map(id=>getOrder(env.BOT_KV,id))).catch(()=>[]);
 for(const o of orders.filter(Boolean))lines.push(`order,${o.id},,${o.price||0},${o.created_at||""}`);
 await telegram.sendDocument(chatId,lines.join("\n"),`vj-stats-${new Date().toISOString().slice(0,10)}.csv`,"📊 خروجی CSV");
}
export async function showAudit(env,telegram,chatId,messageId){const e=(await getRecentAudit(env.BOT_KV,20)).filter(Boolean);await telegram.editOrSend(chatId,e.length ? `📝 <b>فعالیت اخیر</b>\n\n${e.map(x=>`👤 ${x.admin_id} — ⚡ ${x.action} — 🎯 ${JSON.stringify(x.target)}`).join("\n")}` : "فعالیتی ثبت نشده است.",{reply_markup:keyboard([], {back:"admin:group:reports"})});}
