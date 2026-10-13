import {admin,checked,env,json} from '../_shared/http.ts';
import {Razorpay,subscriptionState} from '../_shared/razorpay.ts';
export async function handler(req:Request){
 try{
  if(req.method!=='POST')return json({error:'POST required'},405);
  const raw=new Uint8Array(await req.arrayBuffer());if(raw.length>262144)return json({error:'Too large'},413);
  const provider=new Razorpay(env('RAZORPAY_KEY_ID'),env('RAZORPAY_KEY_SECRET'),env('RAZORPAY_WEBHOOK_SECRET'));
  if(!await provider.verifyWebhook(raw,req.headers.get('x-razorpay-signature')||''))return json({error:'Invalid signature'},401);
  const event=JSON.parse(new TextDecoder().decode(raw)),eventId=req.headers.get('x-razorpay-event-id');
  if(!eventId || eventId.length>160)return json({error:'Missing event ID'},400);
  if(!/^(subscription\.|refund\.processed$|payment\.dispute\.)/.test(event.event))return json({ignored:true});
  const db=admin();let subId=event.payload?.subscription?.entity?.id;
  if(!subId){
   const paymentId=event.payload?.refund?.entity?.payment_id || event.payload?.dispute?.entity?.payment_id || event.payload?.payment?.entity?.id;
   if(!/^pay_[A-Za-z0-9]+$/.test(paymentId||''))return json({ignored:true});
   const payment=await provider.api('payments/'+paymentId);
   if(payment.invoice_id){const invoice=await provider.api('invoices/'+encodeURIComponent(payment.invoice_id));subId=invoice.subscription_id;}
  }
  if(!subId)return json({ignored:true});
  const observedAt=new Date().toISOString(),current=await provider.fetchSubscription(subId);
  let intent=checked(await db.from('checkout_intents').select('*').eq('provider_checkout_id',subId).maybeSingle());
  // Recover a provider success whose response was lost before the checkout ID was stored.
  if(!intent && current.notes?.baymax_intent){
   intent=checked(await db.from('checkout_intents').select('*').eq('id',current.notes.baymax_intent).single());
   if(current.notes.baymax_purchaser!==intent.purchaser_id)throw new Error('Purchaser mismatch');
   checked(await db.from('checkout_intents').update({provider_checkout_id:subId}).eq('id',intent.id).is('provider_checkout_id',null));
  }
  if(!intent)throw new Error('Unknown subscription');
  const plan=checked(await db.from('billing_plans').select('*').eq('code',intent.price_code).single());
  await provider.validatePlan(plan);
  if(current.plan_id!==plan.provider_plan_id || current.quantity!==1 || current.notes?.baymax_intent!==intent.id || current.notes?.baymax_purchaser!==intent.purchaser_id)throw new Error('Subscription does not match checkout');
  const payment=event.payload?.payment?.entity;
  if(event.event==='subscription.charged'&&payment && (payment.currency!==plan.currency || payment.amount!==plan.amount || (current.customer_id && payment.customer_id!==current.customer_id)))throw new Error('Payment price/customer mismatch');
  const state=subscriptionState(current,event.event),end=new Date((current.current_end||0)*1000).toISOString();
  if(state==='active')await provider.verifyPaidCycle(current,plan);
  const applied=checked(await db.rpc('apply_payment_event',{p_event_id:eventId,p_type:event.event,p_subscription:subId,p_state:state,p_end:end,p_cancel:current.cancel_at_cycle_end===true || current.cancel_at_cycle_end===1,p_observed_at:observedAt}));
  return json({received:true,applied});
 }catch(error){console.error('Webhook reconciliation failed:',error instanceof Error?error.message:'unknown');return json({error:'Reconciliation pending; retry required'},503);}
}
Deno.serve(handler);
