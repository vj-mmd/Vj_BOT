import { keyboard } from "../../lib/keyboards.js";
import { getAdminRole, getAdmins, saveAdmins } from "../../lib/kv.js";

export async function requireAdmin(env,userId){const role=await getAdminRole(env.BOT_KV,userId);if(role)return role;const admins=await getAdmins(env.BOT_KV);if(!admins.length&&env.OWNER_ID&&String(userId)===String(env.OWNER_ID)){await saveAdmins(env.BOT_KV,[{id:userId,role:"owner"}]);return"owner";}return null;}

export async function showAdminMenu(env,telegram,chatId,messageId,role){
 const buttons=[
  {text:"🛍 فروش و اشتراک",data:"admin:group:sales"},{text:"💳 مالی و پرداخت",data:"admin:group:finance"},
  {text:"👥 کاربران",data:"admin:group:users"},{text:"🖥 زیرساخت پنل",data:"admin:group:infra"},
  {text:"🤖 تنظیمات ربات",data:"admin:group:bot"},{text:"📊 گزارش و ارتباط",data:"admin:group:reports"}
 ]; if(role==="owner")buttons.push({text:"👨‍💼 ادمین‌ها",data:"admin:admins"});
 await telegram.editOrSend(chatId,messageId,"👨‍💼 <b>پنل مدیریت</b>\n\nیک بخش را انتخاب کنید:",{reply_markup:keyboard(buttons,{perRow:2})});
}

const GROUPS={
 sales:["🛍 محصولات","admin:products","📂 دسته‌بندی‌ها","admin:categories","📦 انبار سرویس","admin:inventory","🎟 تخفیف‌ها","admin:discounts","🧾 فروش دستی","admin:manualsale"],
 finance:["💳 پرداخت‌ها","admin:payments","💰 کیف پول","admin:wallet","📊 آمار","admin:stats"],
 users:["👥 کاربران","admin:users","📢 پیام همگانی","admin:broadcast"],
 infra:["🖥 پنل‌ها","admin:panels","👤 پروفایل‌ها","admin:profiles","📢 کانال‌های اجباری","admin:channels"],
 bot:["⚙️ تنظیمات","admin:settings","❓ سوالات متداول","admin:faq"],
 reports:["💬 پشتیبانی","admin:tickets","📝 گزارش فعالیت","admin:audit"]
};
export async function showAdminGroup(env,telegram,chatId,messageId,key){const g=GROUPS[key];if(!g)return;const b=[];for(let i=0;i<g.length;i+=2)b.push({text:g[i],data:g[i+1]});await telegram.editOrSend(chatId,messageId,`🛠 <b>${({sales:"فروش و اشتراک",finance:"مالی و پرداخت",users:"کاربران",infra:"زیرساخت پنل",bot:"تنظیمات ربات",reports:"گزارش و ارتباط"})[key]}</b>`,{reply_markup:keyboard(b,{perRow:2,back:"admin:main"})});}
