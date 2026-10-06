function endpoint(env,path){const base=env.ZARINPAL_SANDBOX==="true"?"https://sandbox.zarinpal.com/pg/v4/payment": "https://payment.zarinpal.com/pg/v4/payment";return `${base}/${path}`;}
export async function requestPayment(env,{amount,callbackUrl,description,metadata}){
 const merchant=env.ZARINPAL_MERCHANT_ID; if(!merchant)throw Error("ZARINPAL_MERCHANT_ID is not configured");
 const r=await fetch(endpoint(env,"request.json"),{method:"POST",headers:{"Content-Type":"application/json","Accept":"application/json"},body:JSON.stringify({merchant_id:merchant,amount:Number(amount),callback_url:callbackUrl,description,metadata})});
 const d=await r.json(); if(!d.data?.authority)throw Error(`Zarinpal request failed: ${JSON.stringify(d)}`);return d.data.authority;
}
export async function verifyPayment(env,amount,authority){
 const merchant=env.ZARINPAL_MERCHANT_ID;if(!merchant)throw Error("ZARINPAL_MERCHANT_ID is not configured");
 const r=await fetch(endpoint(env,"verify.json"),{method:"POST",headers:{"Content-Type":"application/json","Accept":"application/json"},body:JSON.stringify({merchant_id:merchant,amount:Number(amount),authority})});const d=await r.json();return d.data?.code===100||d.data?.code===101?d.data:null;
}
export function startUrl(env,authority){return `${env.ZARINPAL_SANDBOX==="true"?"https://sandbox.zarinpal.com/pg/StartPay":"https://www.zarinpal.com/pg/StartPay"}/${authority}`;}
