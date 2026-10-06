import { keyboard, confirmKeyboard } from "../../lib/keyboards.js";
import { setState, clearState } from "../../lib/state.js";
import { listInventory, saveInventoryItem, deleteInventoryItem, logAction } from "../../lib/kv.js";

export async function showInventory(env,telegram,chatId,messageId){
  const items=await listInventory(env.BOT_KV); const active=items.filter(i=>i.status!=="sold");
  const buttons=active.slice(0,50).map(i=>({text:`🟢 #${i.id} • ${i.volume_gb}GB • ${i.duration_days}روز`,data:`admin:inv:view:${i.id}`}));
  buttons.push({text:"➕ افزودن کانفیگ به انبار",data:"admin:inv:add"});
  await telegram.editOrSend(chatId,messageId,`📦 <b>انبار سرویس</b>\n\nموجودی فعال: ${active.length}`,{reply_markup:keyboard(buttons,{perRow:1,back:"admin:group:sales"})});
}
export async function showItem(env,telegram,chatId,messageId,id){const i=(await listInventory(env.BOT_KV)).find(x=>x.id===id);if(!i)return;await telegram.editOrSend(chatId,messageId,`📦 <b>انبار #${i.id}</b>\n\n👤 ${i.username||"-"}\n🔗 ${i.subscription_url||"-"}\n📦 ${i.volume_gb}GB\n⏳ ${i.duration_days} روز\n📌 ${i.status||"available"}`,{reply_markup:keyboard([{text:"🗑 حذف",data:`admin:inv:del:${id}`}],{perRow:1,back:"admin:inventory"})});}
export async function promptAdd(env,telegram,chatId,messageId,adminId){await setState(env,adminId,{step:"admin_inv_add",data:{}});await telegram.editOrSend(chatId,messageId,"📦 کانفیگ را در یک پیام با فرمت زیر بفرست:\n\n<code>username|subscription_url|volume_gb|duration_days|panel_id|profile_id</code>", {reply_markup:keyboard([], {back:"admin:inventory"})});}
export async function handleAdd(env,telegram,message,state){const parts=(message.text||"").split("|").map(x=>x.trim());if(parts.length<4)return telegram.sendMessage(message.chat.id,"❌ فرمت صحیح نیست.");const [username,subscription_url,volume_gb,duration_days,panel_id,profile_id]=parts;const item=await saveInventoryItem(env.BOT_KV,{username,subscription_url,volume_gb:Number(volume_gb),duration_days:Number(duration_days),panel_id:panel_id?Number(panel_id):null,profile_id:profile_id?Number(profile_id):null,status:"available",created_at:Date.now()});await clearState(env,message.from.id);await logAction(env.BOT_KV,message.from.id,"add_inventory",item.id);return showInventory(env,telegram,message.chat.id,null);}
export async function confirmDelete(env,telegram,chatId,messageId,id){await telegram.editOrSend(chatId,messageId,"⚠️ این کانفیگ از انبار حذف شود؟",{reply_markup:confirmKeyboard(`admin:inv:delete:${id}`,`admin:inv:view:${id}`)});}
export async function remove(env,telegram,chatId,messageId,adminId,id){await deleteInventoryItem(env.BOT_KV,id);await logAction(env.BOT_KV,adminId,"delete_inventory",id);return showInventory(env,telegram,chatId,messageId);}
