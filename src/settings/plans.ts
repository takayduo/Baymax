import {h} from '../views/dom';
import {State} from '../core/state';
import {Account,openAccount} from '../core/account';

export const PLAN_OPTIONS = [
 {id:'free',name:'Free',price:'₹0',period:'forever',features:['Solo music & local playlists','Groq AI companion · your API key','Local tasks','Personal Supabase support']},
 {id:'pro',name:'Pay for yourself',price:'₹199',period:'/ month',features:['Baymax Cloud database sync','Listen Together','Remote PC Control','Productivity & Gemini Live','One person · Pro']},
 {id:'duo',name:'Pay for both',price:'₹349',period:'/ month',features:['Everything in Pro','Two premium seats','One payment for both of you','Your partner pays ₹0']},
] as const;

export function promptAssignPartnerSeat(opts: {
 title?: string;
 subtitle?: string;
 canSkip?: boolean;
 onDone?: (username?: string) => void;
 onAssign?: (username:string) => Promise<unknown>;
}): void {
 if (document.querySelector('.duo-assign-dialog')) return;
 const dialog = document.createElement('dialog');
 dialog.className = 'upgrade-dialog duo-assign-dialog';
 dialog.style.textAlign = 'left';

 const title = h('h2', {
  style: 'margin:0 0 8px;font-size:17px;font-weight:600;color:#edf5f2;',
  text: opts.title || 'Assign Duo Partner Seat'
 });
 const copy = h('p', {
  style: 'margin:0 0 16px;font-size:12px;line-height:1.5;color:#a9b8b3;',
  text: opts.subtitle || 'Enter your partner’s registered @username. They receive Duo access and an invitation to connect.'
 });

 const inputWrap = h('div', {style: 'margin-bottom:16px;'});
 const usernameInput = h('input', {
  type: 'text',
  placeholder: 'Partner’s @username',
  maxLength: 25,
  style: 'width:100%;box-sizing:border-box;padding:10px 12px;background:#0c101380;border:1px solid #ffffff24;border-radius:10px;color:#edf5f1;font:inherit;outline:none;'
 }) as HTMLInputElement;
 const errorText = h('p', {style: 'margin:6px 0 0;font-size:11px;color:#ff9898;display:none;'});
 inputWrap.append(usernameInput, errorText);

 const btnRow = h('div', {style: 'display:flex;gap:10px;justify-content:flex-end;'});
 const close = () => {
  dialog.close();
  dialog.remove();
 };

 const assignBtn = h('button', {
  type: 'button',
  class: 'btn primary',
  style: 'padding:8px 16px;font-size:12px;',
  text: 'Assign seat',
  onclick: async () => {
   const val = usernameInput.value.trim().replace(/^@/, '');
   if (!val) {
    errorText.textContent = 'Please enter a username.';
    errorText.style.display = 'block';
    usernameInput.focus();
    return;
   }
   assignBtn.disabled = true;
   assignBtn.textContent = 'Assigning…';
   try {
    if(opts.onAssign)await opts.onAssign(val);else await Account.action('assign-seat',{username:val});
    close();
    opts.onDone?.(val);
   } catch (err: any) {
    assignBtn.disabled = false;
    assignBtn.textContent = 'Assign seat';
    errorText.textContent = err?.message || 'Failed to assign seat. Make sure username exists.';
    errorText.style.display = 'block';
   }
  }
 });

 const cancelBtn = h('button', {
  type: 'button',
  class: 'btn glass',
  style: 'padding:8px 14px;font-size:12px;color:#abbcb6;',
  text: opts.canSkip ? 'Skip for now' : 'Cancel',
  onclick: () => {
   close();
   opts.onDone?.();
  }
 });

 usernameInput.onkeydown = (e) => {
  if (e.key === 'Enter') {
   e.preventDefault();
   assignBtn.click();
  }
 };

 btnRow.append(cancelBtn, assignBtn);
 dialog.append(title, copy, inputWrap, btnRow);
 dialog.addEventListener('cancel', (e) => {
  e.preventDefault();
  close();
  opts.onDone?.();
 });

 (document.querySelector('#island-clip') || document.body).append(dialog);
 dialog.showModal();
 usernameInput.focus();
}

export function plansSection(onComplete?:()=>void):HTMLElement {
 const el=h('section',{class:'plans-section'}),summary=h('div',{class:'plans-summary'}),toggleWrap=h('div',{class:'billing-toggle'}),grid=h('div',{class:'plan-cards'}),status=h('p',{class:'plan-notice',role:'status','aria-live':'polite'});
 let cycle:'monthly'|'annual'='annual',busy=false,key='',prices:any[]=[];

 const pillMonthly=h('button',{type:'button',class:'billing-pill',text:'Monthly',onclick:()=>{cycle='monthly';syncToggle();render();}});
 const pillAnnual=h('button',{type:'button',class:'billing-pill active',onclick:()=>{cycle='annual';syncToggle();render();}});
 pillAnnual.append('Annual ',h('span',{class:'badge-discount',text:'Save 16%'}));
 toggleWrap.append(pillMonthly,pillAnnual);

 function syncToggle(){
  pillMonthly.className='billing-pill'+(cycle==='monthly'?' active':'');
  pillAnnual.className='billing-pill'+(cycle==='annual'?' active':'');
 }

 async function choose(id:'free'|'pro'|'duo'){
  if(busy)return;
  if(!State.account?.user||!State.account.profile){openAccount();return;}
  const currentPlan = State.account.entitlement?.plan;
  const isPurchaser = State.account.entitlement?.purchaserId === State.account.user?.id;
  const partnerAssigned = !!State.account.entitlement?.partnerSeat;

  if(id==='duo'&&currentPlan!=='duo'&&State.account.config.razorpayKeyId){
   promptAssignPartnerSeat({title:'Duo · choose your partner',subtitle:'Reserve the second seat for your partner before checkout. You connect after they accept.',onAssign:username=>Account.billing('createCheckout',{priceCode:`duo_${cycle}`,partnerUsername:username}),onDone:username=>{if(username)status.textContent='Checkout opened. Both seats activate after payment is verified.';}});
   return;
  }

  // If already on Duo and clicking to assign unassigned seat:
  if(id==='duo'&&currentPlan==='duo'&&isPurchaser&&!partnerAssigned){
   promptAssignPartnerSeat({
    title:'Assign Duo Partner Seat',
    subtitle:'Enter your partner’s registered @username to activate their Duo access and connect.',
    canSkip:false,
    onDone:async(assigned)=>{
     if(assigned){
      status.textContent=`Duo seat assigned to @${assigned}!`;
      const next=await Account.snapshot();if(next){State.account=next;State.notify();}
      render();
     }
    }
   });
   return;
  }

  const continuing=id==='free'||(currentPlan===id&&!State.account.planChosen);
  busy=true;status.textContent='Setting up your plan…';render();
  try{
   if(continuing){await Account.action('continue-free');status.textContent='Your plan is ready. Enjoy Baymax.';}
   else{
    const priceCode=`${id}_${cycle}`;
    const result=await Account.billing('createCheckout',{priceCode,partnerUsername:''});
    status.textContent=result.testing?'Your 365-day beta membership is active. No payment needed.':'Checkout opened. Your plan activates when payment is verified.';
    const next=await Account.snapshot();if(next&&typeof next==='object'&&'capabilities'in next){State.account=next;State.notify();}
    // If user just bought Duo and has no partner seat assigned, show dialog
    if(id==='duo'&&!partnerAssigned){
     promptAssignPartnerSeat({
      title:'Pay for Both · Duo Activated',
      subtitle:'Would you like to assign your 2nd Duo seat to your partner now? If you skip, you can assign it anytime from the Account tab.',
      canSkip:true,
      onDone:async(assigned)=>{
       if(assigned){
        status.textContent=`Duo seat assigned to @${assigned}!`;
        const updated=await Account.snapshot();if(updated){State.account=updated;State.notify();}
       }
       render();
      }
     });
    }
   }
   if(continuing||!State.account?.config.razorpayKeyId)onComplete?.();
  }catch(error){status.textContent=error instanceof Error?error.message:'Could not update your plan. Please retry.';}
  finally{busy=false;key='';render();}
 }

 function render(){
  const a=State.account,plan=a?.entitlement?.plan||'free';
  const partnerSeatUser=a?.entitlement?.partnerSeat?.username;
  const stamp=JSON.stringify([plan,cycle,a?.entitlement?.periodEnd,a?.capabilities.grace,a?.config.razorpayKeyId,a?.user?.id,busy,prices,partnerSeatUser,a?.pair?.id]);if(stamp===key)return;key=stamp;
  summary.replaceChildren(h('span',{class:'plan-status-badge',text:`● ${plan==='duo'?'Pay for both':plan==='pro'?'Pay for yourself':'Free'} (Active)`}));
  if(a?.entitlement?.periodEnd)summary.append(h('span',{text:a.entitlement.periodEnd==='infinity'?'Lifetime membership':`${a.entitlement.provider==='beta_test'?'Beta until':'Current period ends'} ${new Date(a.entitlement.periodEnd).toLocaleDateString()}`}));
  if(plan==='duo'&&partnerSeatUser)summary.append(h('span',{style:'color:#a5cbbe;font-size:11px;',text:`Partner seat: @${partnerSeatUser}`}));
  if(!a?.config.razorpayKeyId)summary.append(h('p',{text:'Beta access · choose Pro or Duo for 365 days free. No card or automatic renewal.'}));
  grid.replaceChildren();
  for(const option of PLAN_OPTIONS){
   const paid=option.id!=='free',server=prices.find(p=>p.code===`${option.id}_${cycle}`);
   const basePrice = cycle === 'annual'
    ? (option.id === 'pro' ? '₹1,999' : option.id === 'duo' ? '₹3,499' : '₹0')
    : option.price;
   const basePeriod = option.id === 'free' ? 'forever' : (cycle === 'annual' ? '/ year' : '/ month');
   const price=server?new Intl.NumberFormat('en-IN',{style:'currency',currency:server.currency,maximumFractionDigits:0}).format(server.amount/100):basePrice;
   const current=plan===option.id&&!!a?.planChosen;
   const partnerAssigned = !!a?.entitlement?.partnerSeat;
   const canAssign=current&&option.id==='duo'&&a.entitlement?.purchaserId===a.user?.id&&!partnerAssigned;
   const continueAssigned=plan===option.id&&!a?.planChosen&&option.id!=='free';
   const card=h('article',{class:'plan-card'+(current?' selected':''),'data-plan':option.id},h('h3',{text:option.name}),h('div',{class:'plan-price'},h('strong',{text:price}),h('span',{text:basePeriod})),h('ul',{},...option.features.map(text=>h('li',{text}))));
   card.append(h('button',{type:'button',class:'btn glass',disabled:busy||(current&&!canAssign)||(option.id==='free'&&plan!=='free'),text:current?(canAssign?'Assign partner seat':'Current plan'):continueAssigned?'Continue with '+(option.id==='duo'?'Duo':'Pro'):paid?option.name:'Continue free',onclick:()=>void choose(option.id)}));
   grid.append(card);
  }
 }
 const refresh=h('button',{type:'button',class:'btn glass',text:'Refresh membership',onclick:async()=>{if(busy)return;try{const a=await Account.refresh();State.account=a;render();status.textContent=a.error||'Membership updated.';}catch(e){status.textContent=String(e);}}});
 el.append(summary,toggleWrap,grid,h('p',{class:'plan-footnote',text:(!State.account?.config.razorpayKeyId?'Beta: Pro & Duo are free for 365 days. ':'')+'Bring your own AI keys; provider usage is billed separately. Sharing starts after your partner accepts.'}));
 if(!onComplete)el.append(refresh);
 el.append(status);
 const update=()=>{if(el.isConnected)render();};window.addEventListener('baymax-account-changed',update);
 const observer=new MutationObserver(()=>{if(!document.querySelector('.settings-surface')&&!el.isConnected){window.removeEventListener('baymax-account-changed',update);observer.disconnect();}});queueMicrotask(()=>observer.observe(document.body,{childList:true,subtree:true}));
 render();
 if(State.account?.user&&State.account.config.razorpayKeyId)void Account.billing('plans').then(r=>{prices=r.plans||[];render();}).catch(()=>{status.textContent='Checkout is not ready yet. Please try again later.';});
 return el;
}
