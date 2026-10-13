import {body,checked,env,identity,serve,username} from '../_shared/http.ts';
import {Razorpay} from '../_shared/razorpay.ts';
export const handler=serve(async req=>{
 const {db,user}=await identity(req),b=await body(req);
 checked(await db.rpc('limit_action',{p_actor:user.id,p_action:'billing',p_limit:30,p_seconds:60}));
 const plans=checked(await db.from('billing_plans').select('*').eq('enabled',true))||[];
 const ready=!!env('RAZORPAY_KEY_ID')&&!!env('RAZORPAY_KEY_SECRET')&&!!env('RAZORPAY_WEBHOOK_SECRET');
 if(b.op==='plans')return {ready,keyId:env('RAZORPAY_KEY_ID'),plans:plans.map(({provider_plan_id,...p})=>p)};
 const provider=new Razorpay(env('RAZORPAY_KEY_ID'),env('RAZORPAY_KEY_SECRET'),env('RAZORPAY_WEBHOOK_SECRET'));
 if(b.op==='createCheckout'){
  if(!ready)throw new Error('Razorpay setup is not complete');
  const plan=plans.find(p=>p.code===b.priceCode);if(!plan)throw new Error('The selected plan is not configured on the server');
  const recipient=plan.plan_code==='duo'?checked(await db.from('profiles').select('user_id').eq('username',username(b.partnerUsername)).single())!.user_id:null;
  await provider.validatePlan(plan);
  const intent=checked(await db.rpc('prepare_checkout',{p_actor:user.id,p_price:plan.code,p_recipient:recipient}));
  if(intent.checkout_url)return {url:intent.checkout_url,intentId:intent.id,status:'Payment processing'};
  // Only one caller wins the create lease. A crashed create is reconciled by its intent ID in provider notes.
  const lease=checked(await db.from('checkout_intents').update({status:'pending'}).eq('id',intent.id).eq('status','creating').select('id'));
  if(!lease?.length)throw new Error('Checkout is being prepared. Refresh shortly; do not pay twice.');
  try{
   const checkout=await provider.createCheckout(plan,intent);
   checked(await db.from('checkout_intents').update({provider_checkout_id:checkout.id,checkout_url:checkout.url}).eq('id',intent.id));
   return {url:checkout.url,intentId:intent.id,status:'Payment processing'};
  }catch(error){
   // Do not create a second subscription after an ambiguous provider timeout.
   throw new Error('Checkout could not be confirmed. The server retains your intent for reconciliation; no entitlement was granted.');
  }
 }
 const sub=checked(await db.from('subscriptions').select('*').eq('id',b.subscriptionId).eq('purchaser_id',user.id).eq('provider','razorpay').single());
 if(b.op==='fetchSubscription')return {subscription:await provider.fetchSubscription(sub.provider_subscription_id)};
 if(b.op==='cancelAtPeriodEnd'){
  const subscription=await provider.cancelAtPeriodEnd(sub.provider_subscription_id);
  checked(await db.from('subscriptions').update({cancelled_at_period_end:true}).eq('id',sub.id));return {subscription,message:'Cancellation scheduled at the end of your paid period'};
 }
 throw new Error('Unknown billing operation');
});
Deno.serve(handler);
