// Provider adapter. This module has no Deno globals and is exercised by Node tests.
export interface Plan {code:string;plan_code:'pro'|'duo';provider_plan_id:string;amount:number;currency:string;period:string;total_count:number}
export class Razorpay {
 constructor(readonly keyId:string,private secret:string,private webhookSecret:string,private request:typeof fetch=fetch){
  if(!/^rzp_(test|live)_[A-Za-z0-9]+$/.test(keyId)||!secret)throw new Error('Razorpay setup is not complete');
 }
 async api(path:string,method='GET',body?:unknown){
  const response=await this.request('https://api.razorpay.com/v1/'+path,{method,headers:{authorization:'Basic '+btoa(this.keyId+':'+this.secret),'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
  const result=await response.json();if(!response.ok)throw new Error(result.error?.description || 'Payment provider unavailable');return result;
 }
 async validatePlan(plan:Plan){
  const actual=await this.api('plans/'+encodeURIComponent(plan.provider_plan_id));
  if(actual.id!==plan.provider_plan_id || actual.item?.amount!==plan.amount || actual.item?.currency!==plan.currency || actual.period!==plan.period || actual.interval!==1)throw new Error('Provider price does not match the configured plan');
  return actual;
 }
 async createCheckout(plan:Plan,intent:{id:string;purchaser_id:string;recipient_id?:string|null}){
  await this.validatePlan(plan);
  const subscription=await this.api('subscriptions','POST',{plan_id:plan.provider_plan_id,total_count:plan.total_count,quantity:1,customer_notify:true,expire_by:Math.floor(Date.now()/1000)+86400,notes:{baymax_intent:intent.id,baymax_purchaser:intent.purchaser_id}});
  const url=new URL(subscription.short_url);
  if(url.protocol!=='https:' || !['rzp.io','razorpay.com','www.razorpay.com'].includes(url.hostname))throw new Error('Unexpected payment checkout URL');
  return {id:subscription.id,url:url.href};
 }
 fetchSubscription(id:string){if(!/^sub_[A-Za-z0-9]+$/.test(id))throw new Error('Invalid subscription');return this.api('subscriptions/'+id);}
 async verifyPaidCycle(subscription:any,plan:Plan){
  // Subscription status alone is insufficient: confirm its captured invoice payment.
  const invoices=await this.api('invoices?subscription_id='+encodeURIComponent(subscription.id)+'&count=100');
  const invoice=(invoices.items||[]).filter((i:any)=>i.status==='paid'&&i.subscription_id===subscription.id&&i.amount_paid===plan.amount&&i.currency===plan.currency&&i.payment_id).sort((a:any,b:any)=>b.paid_at-a.paid_at)[0];
  if(!invoice||!subscription.current_start||invoice.paid_at<subscription.current_start-86400)throw new Error('Current paid invoice is not available yet');
  const payment=await this.api('payments/'+encodeURIComponent(invoice.payment_id));
  if(payment.status!=='captured'||payment.amount!==plan.amount||payment.currency!==plan.currency||payment.invoice_id!==invoice.id||!subscription.customer_id||payment.customer_id!==subscription.customer_id||payment.amount_refunded>0)throw new Error('Captured payment does not match subscription');
  return payment;
 }
 cancelAtPeriodEnd(id:string){if(!/^sub_[A-Za-z0-9]+$/.test(id))throw new Error('Invalid subscription');return this.api('subscriptions/'+id+'/cancel','POST',{cancel_at_cycle_end:1});}
 async verifyWebhook(raw:Uint8Array,signature:string){
  if(!this.webhookSecret || !/^[a-f0-9]{64}$/i.test(signature))return false;
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(this.webhookSecret),{name:'HMAC',hash:'SHA-256'},false,['verify']);
  return crypto.subtle.verify('HMAC',key,Uint8Array.from(signature.match(/../g)!,s=>parseInt(s,16)),new Uint8Array(raw));
 }
}
export function subscriptionState(value:any,kind:string){
 if(kind==='refund.processed')return 'refunded';
 if(kind.startsWith('payment.dispute.'))return 'disputed';
 if(value.status==='active' && value.paid_count>0 && value.current_end*1000>Date.now())return 'active';
 if(value.status==='cancelled')return 'cancelled';
 if(['halted','paused','pending'].includes(value.status))return 'halted';
 if(['completed','expired'].includes(value.status))return 'expired';
 return 'pending';
}
