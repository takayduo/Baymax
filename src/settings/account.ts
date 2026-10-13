import {h} from '../views/dom';
import {State} from '../core/state';
import {Account,openPlans,requireFeature} from '../core/account';
import {Bridge} from '../core/bridge';

export function accountSection(mode:'account'|'database'='account'){
 const el=h('section',{class:'account-section'}),status=h('p',{class:'account-status',role:'status'}),content=h('div');
 let state=State.account,busy=false,notice='',foundProfile:any=null,searchDraft='';
 const input=(label:string,value='',type='text')=>h('input',{type,value,placeholder:label,'aria-label':label}) as HTMLInputElement;
 const btn=(label:string,run:()=>unknown,kind='')=>h('button',{type:'button',class:kind,text:label,onclick:()=>void task(run)});

 async function task(run:()=>unknown){
  if(busy)return;busy=true;notice='';status.textContent='Working…';
  try{
   await run();
   if(status.textContent!=='Working…')notice=status.textContent||'';
   const next=await Account.snapshot();
   if(next&&typeof next==='object'&&'capabilities'in next){state=next;State.account=next;}
   render();
   status.textContent=notice;
  }catch(e){
   status.textContent=e instanceof Error?e.message:String(e);
  }finally{
   busy=false;
  }
 }

 function field(label:string,node:HTMLElement){return h('label',{class:'account-field'},h('span',{text:label}),node);}

 function render(){
  content.replaceChildren();
  if(!state?.configured){
   content.append(h('h2',{text:'Connect your Baymax account service'}),h('p',{text:'The central service is not configured. Local beta features remain available until a project URL is added.'}));
  }else if(!state.user){
   content.append(h('h2',{text:'Welcome to Baymax'}),h('p',{text:'Continue with Google, choose your username, then choose Free, Pro or Duo.'}),btn(state.loggingIn?'Open Google again':'Continue with Google',()=>Account.login(),'account-primary'),btn('Show welcome',()=>window.dispatchEvent(new Event('baymax-open-welcome'))));
   if(state.loggingIn)content.append(btn('Cancel sign-in',()=>Account.cancelLogin()));
  }else if(mode==='database'){
   content.append(customDatabase());
  }else if(!state.profile){
   const name=input('Username'),display=input('Display name',state.user.displayName||'');name.maxLength=24;display.maxLength=80;
   content.append(h('h2',{text:'Choose your @username'}),h('p',{text:'3–24 lowercase letters, numbers or underscores. Your username connects you with your partner.'}),field('Username',name),field('Display name',display),btn('Reserve username',()=>Account.action('reserve',{username:name.value,displayName:display.value}),'account-primary'));
  }else{
   const entitlement=state.entitlement;
   const plan=entitlement?.provider==='manual_grant'?`Comped ${entitlement.plan==='duo'?'Duo':'Pro'}`:entitlement?.plan==='duo'?'Duo':entitlement?.plan==='pro'?'Pro':'Free';
   const isPaid=['pro','duo'].includes(entitlement?.plan||'free')&&(entitlement?.provider==='manual_grant'||entitlement?.provider==='beta_test'||(entitlement?.periodEnd&&Date.parse(entitlement.periodEnd)>Date.now()));

   // 1. Account Summary
   const summary=h('div',{class:'account-summary'},h('div',{},h('h2',{text:'@'+state.profile.username}),h('p',{text:state.user.email})),h('span',{class:'account-plan-badge',text:plan}));
   content.append(summary,h('p',{text:'Bring your own AI keys on every plan. API usage is billed separately by your provider.'}));

   if(entitlement?.periodEnd)content.append(h('p',{text:`${entitlement.cancelAtPeriodEnd?'Access ends':'Current period ends'} ${new Date(entitlement.periodEnd).toLocaleDateString()}.`}));
   if(state.capabilities.grace)content.append(h('p',{text:'Offline access is using the last verified subscription, for up to 72 hours or the end of your paid period.'}));

   content.append(btn('Plans & Membership',()=>openPlans()));
   if(entitlement?.provider==='razorpay'&&entitlement.purchaserId===state.user.id){
    content.append(btn('Manage subscription',async()=>{const r=await Account.billing('fetchSubscription',{subscriptionId:entitlement.subscriptionId});status.textContent=`Provider status: ${r.subscription.status}. Renewal: ${r.subscription.charge_at?new Date(r.subscription.charge_at*1000).toLocaleDateString():'not scheduled'}.`;}),btn('Cancel at period end',()=>{if(confirm('Stop renewal at the end of this paid period? Your partner subscription is not cancelled separately.'))return Account.billing('cancelAtPeriodEnd',{subscriptionId:entitlement.subscriptionId});}));
   }

   // 2. Separation: FREE vs PAID
   if(!isPaid){
    // FREE USER: Simple, clean experience
    const coupleCard=h('div',{class:'couple-free-card'},
     h('h4',{text:'Couple Cloud Pairing'}),
     h('p',{text:'Cloud partner pairing, Gemini Live, Listen Together, and Remote PC Control are included in Pro and Duo. Upgrade your plan to invite and sync with your partner in real time.'})
    );
    content.append(h('hr'),coupleCard);

    // Free users can accept invitations
    const invite=input('Enter partner invitation token or code');
    content.append(field('Have an invitation?',invite),btn('Accept invitation',async()=>{
     const raw=invite.value.trim();
     if(!raw){status.textContent='Please enter an invitation token.';return;}
     const [id,token]=raw.includes('.')?raw.split('.'):[raw,null];
     await Account.action('accept',{id,token,customConsent:false});
     status.textContent='Invitation accepted!';
    }));

    for(const inv of state.invites||[]){
     const incoming=inv.recipientId===state.user.id;
     if(incoming){
      content.append(h('div',{class:'account-invite'},h('span',{text:`Invitation from @${inv.sender}`}),btn('Accept',()=>Account.action('accept',{id:inv.id,customConsent:false})),btn('Decline',()=>Account.action('decline',{id:inv.id}))));
     }
    }

    content.append(h('hr'),btn('Sign out',()=>Account.logout()));
   }else{
    // PAID USER: Pro / Duo experience
    content.append(h('hr'));

    // Duo partner seat assignment or revocation (if user purchased Duo)
    if(entitlement?.plan==='duo'&&entitlement.purchaserId===state.user.id){
     const partnerSeat=entitlement.partnerSeat;
     if(partnerSeat?.username){
      const seatCard=h('div',{class:'plan-duo-seat'},
       h('div',{style:'display:flex;align-items:center;justify-content:space-between;gap:12px;'},
        h('div',{},
         h('h4',{style:'margin:0;font-size:12px;color:#cbe7dc',text:'Duo Partner Seat'}),
         h('p',{style:'margin:2px 0 0;font-size:11px;color:#9eb5ac',text:`Assigned to @${partnerSeat.username} · Active`})
        ),
        btn('Revoke seat',async()=>{
         if(!confirm(`Revoke Duo seat from @${partnerSeat.username}? They will revert to the Free plan and your 2nd seat will become available again.`))return;
         status.textContent='Revoking seat…';
         try{
          await Account.action('revoke-seat');
          status.textContent=`Duo seat revoked from @${partnerSeat.username}.`;
          const next=await Account.snapshot();if(next){State.account=next;State.notify();}
          render();
         }catch(e:any){
          status.textContent=e?.message||'Could not revoke seat.';
         }
        },'btn glass')
       )
      );
      content.append(seatCard);
     }else if(!state.pair){
      const seatUser=input('Partner’s registered @username');
      const seatCard=h('div',{class:'plan-duo-seat'},
       h('h4',{style:'margin:0;font-size:12px;color:#cbe7dc',text:'Duo Partner Seat · Available'}),
       h('p',{style:'margin:0;font-size:11px;color:#9eb5ac',text:'Gift your second Duo seat. Enter your partner’s @username to activate their Duo access.'}),
       h('div',{style:'display:flex;gap:8px;align-items:center;margin-top:6px;'},
        seatUser,
        btn('Gift seat',async()=>{
         const target=seatUser.value.trim().replace(/^@/,'');
         if(!target){status.textContent='Enter your partner’s @username.';return;}
         if(!confirm(`Assign Duo seat to @${target}? They will receive full Duo access and connect with you.`))return;
         status.textContent='Assigning Duo seat…';
         try{
          await Account.billing('createCheckout',{priceCode:'duo_annual',partnerUsername:target});
          status.textContent=`Duo seat assigned to @${target}!`;
          const next=await Account.snapshot();if(next){State.account=next;State.notify();}
          render();
         }catch(e:any){
          status.textContent=e?.message||'Could not assign seat.';
         }
        },'account-primary')
       )
      );
      seatUser.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();const giftBtn=seatCard.querySelector('button.account-primary') as HTMLButtonElement;giftBtn?.click();}};
      content.append(seatCard);
     }
    }

    if(state.pair){
     // Connected with partner
     const other=state.pair.members.find((m:any)=>m.userId!==state!.user!.id);
     const otherUsername=other?.username||'partner';

     // Your gender toggle: He / She
     const myGender=(State.settings.userRole||'me')==='her'?'she':'he';
     const btnHe=h('button',{
      type:'button',
      class:myGender==='he'?'btn primary':'btn secondary',
      style:'padding:5px 16px;font-size:12px;',
      text:'He',
      onclick:()=>{
       State.settings.userRole='me';
       void Bridge.saveSettings({userRole:'me'});
       render();
      }
     });
     const btnShe=h('button',{
      type:'button',
      class:myGender==='she'?'btn primary':'btn secondary',
      style:'padding:5px 16px;font-size:12px;',
      text:'She',
      onclick:()=>{
       State.settings.userRole='her';
       void Bridge.saveSettings({userRole:'her'});
       render();
      }
     });
     const genderRow=h('div',{style:'display:flex;align-items:center;gap:10px;margin:8px 0;padding:10px 14px;background:#ffffff06;border:1px solid #ffffff12;border-radius:12px;'},
      h('span',{style:'flex:1;font-size:12px;color:var(--dim);',text:'Your gender:'}),
      btnHe,
      btnShe
     );

     // Notify when partner comes online toggle
     const notifyToggle=h('button',{
      class:State.settings.notifyPartnerOnline!==false?'switch on':'switch',
      'aria-pressed':String(State.settings.notifyPartnerOnline!==false),
      onclick:()=>{
       const next=!notifyToggle.classList.contains('on');
       notifyToggle.classList.toggle('on',next);
       notifyToggle.setAttribute('aria-pressed',String(next));
       State.settings.notifyPartnerOnline=next;
       void Bridge.saveSettings({notifyPartnerOnline:next});
      }
     });
     const notifyRow=h('div',{style:'display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:#ffffff06;border:1px solid #ffffff12;border-radius:12px;margin:8px 0;'},
      h('div',{style:'display:flex;flex-direction:column;gap:3px;'},
       h('strong',{style:'font-size:12px;color:var(--ink);',text:'Notify when partner comes online'}),
       h('span',{style:'font-size:11px;color:var(--dim);',text:'Plays a sweet chime and hearts emote when your partner turns on their PC'})
      ),
      notifyToggle
     );

     content.append(
      h('h3',{text:'Your partner'}),
      h('p',{text:`Connected with @${otherUsername} · ${state.pair.backend_kind==='cloud'?'Baymax Cloud':'Custom database'}`}),
      genderRow,
      notifyRow,
      btn('End relationship',()=>{if(confirm('End this relationship and revoke shared access? Any granted Duo seat will be returned to the plan purchaser.'))return Account.action('end-pair');})
     );
    }else{
     // Not paired: Search partner by pressing Enter
     content.append(h('h3',{text:'Find your partner'}));
     const searchInput=input('Partner @username (press Enter to search)',searchDraft);

     searchInput.oninput=()=>{searchDraft=searchInput.value;};
     searchInput.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();void doSearch();}};

     const foundArea=h('div',{class:'account-lookup'});

     async function doSearch(){
      const query=searchInput.value.trim().replace(/^@/,'');
      if(!query){status.textContent='Please enter a username to search.';return;}
      status.textContent='Searching…';
      foundArea.replaceChildren();
      foundProfile=null;
      const r=await Account.action('lookup',{username:query});
      if(r?.profile){
       foundProfile=r.profile;
       status.textContent='';
       const previewCard=h('div',{class:'partner-found-card'},
        h('div',{},h('strong',{style:'font-size:12px;color:#e8f4ef',text:`@${foundProfile.username}`}),h('span',{style:'display:block;font-size:11px;color:#a4b4ad',text:foundProfile.display_name||foundProfile.username})),
        btn('Send invitation',async()=>{
         await Account.action('invite',{username:foundProfile.username});
         status.textContent=`Invitation sent to @${foundProfile.username}!`;
         foundProfile=null;
         foundArea.replaceChildren();
        },'account-primary')
       );
       foundArea.append(previewCard);
      }else{
       status.textContent='No matching account found. Make sure they have registered their @username.';
      }
     }

     if(foundProfile){
      const previewCard=h('div',{class:'partner-found-card'},
       h('div',{},h('strong',{style:'font-size:12px;color:#e8f4ef',text:`@${foundProfile.username}`}),h('span',{style:'display:block;font-size:11px;color:#a4b4ad',text:foundProfile.display_name||foundProfile.username})),
       btn('Send invitation',async()=>{
        await Account.action('invite',{username:foundProfile.username});
        status.textContent=`Invitation sent to @${foundProfile.username}!`;
        foundProfile=null;
        foundArea.replaceChildren();
       },'account-primary')
      );
      foundArea.append(previewCard);
     }

     content.append(field('Partner username',searchInput),foundArea);

     // Redeem invite box
     const inviteInput=input('Invitation token');
     content.append(field('Have an invitation code?',inviteInput),btn('Accept invitation',async()=>{
      const raw=inviteInput.value.trim();
      if(!raw){status.textContent='Please enter an invitation token.';return;}
      const [id,token]=raw.includes('.')?raw.split('.'):[raw,null];
      await Account.action('accept',{id,token,customConsent:false});
      status.textContent='Invitation accepted!';
     }));
    }

    // Pending Invites list
    for(const invite of state.invites||[]){
     const incoming=invite.recipientId===state.user.id;
     content.append(h('div',{class:'account-invite'},h('span',{text:incoming?`Invitation from @${invite.sender}`:'Invitation sent · Waiting for acceptance'}),...(incoming?[btn('Accept',()=>Account.action('accept',{id:invite.id,customConsent:false})),btn('Decline',()=>Account.action('decline',{id:invite.id}))]:[btn('Cancel invite',()=>Account.action('revoke',{id:invite.id}))])));
    }

    content.append(h('hr'),btn('Sign out',()=>Account.logout()));
   }
  }
  if(state?.error)content.append(h('p',{class:'account-error',text:state.error}));
 }

 function customDatabase(){
  const details=h('div',{class:'account-config'}),url=input('https://your-project.supabase.co'),key=input('Personal Supabase anon key');
  const personal=h('div');
  const cloud=btn('Baymax Cloud Database',()=>{if(!['pro','duo'].includes(state?.entitlement?.plan||'free')){requireFeature('cloud');return;}personal.hidden=true;if(state?.pair?.backend_kind==='custom')status.textContent='Choose Baymax Cloud below to request a shared database switch.';else status.textContent='Baymax Cloud is included. Connect with your partner to start syncing.';});
  const own=btn('Personal Supabase Database',()=>{personal.hidden=false;});
  cloud.setAttribute('aria-pressed',String(state?.pair?.backend_kind==='cloud'));own.setAttribute('aria-pressed',String(state?.pair?.backend_kind==='custom'));details.append(h('div',{class:'database-choice'},cloud,own));
  personal.append(h('p',{text:'Use your own Supabase project. Apply the Baymax personal database template once; your partner must agree before sharing data with it.'}),field('Supabase URL',url),field('Anon key',key),btn('Prepare connection',async()=>{const r=await Account.action('backend-prepare',{endpoint:url.value.trim().replace(/\/$/,'')+'/functions/v1/custom-adapter',publicKey:key.value.trim()});status.textContent='Setup details copied. Complete the personal database setup guide, then verify your connection.';await window.electronAPI?.writeClipboard?.(JSON.stringify(r,null,2));}));
  personal.hidden=state?.pair?.backend_kind==='cloud';details.append(personal);
  for(const backend of state?.backends||[])details.append(h('div',{class:'account-invite'},h('span',{text:`${new URL(backend.endpoint).hostname} · ${backend.status}`}),...(backend.status==='pending'?[btn('Verify setup',()=>Account.action('backend-confirm',{id:backend.id}))]:[])));
  if(state?.pair){
   const target=h('select',{'aria-label':'New shared database'}) as HTMLSelectElement;
   target.append(h('option',{value:'',text:'Baymax Cloud — both need Pro/Duo'}));for(const b of state.backends||[])if(b.status==='ready')target.append(h('option',{value:b.id,text:'My database · '+new URL(b.endpoint).hostname}));
   details.append(h('h3',{text:'Move our shared data'}),h('p',{text:'Export a backup first. Your partner must accept. Chat and task sync pauses during copying; your original copy is preserved. Download backups before switching.'}),field('Destination',target),btn('Ask partner to switch',()=>Account.action('migration-propose',{backendId:target.value||null})));
   for(const change of state.migrations||[]){
    const row=h('div',{class:'account-invite'},h('span',{text:`Database switch · ${change.status} · ${change.checkpoint?.counts?.messages||0} messages, ${change.checkpoint?.counts?.tasks||0} tasks copied`}));
    if(change.status==='proposed'&&change.requested_by!==state.user?.id)row.append(btn('Accept & pause sync',()=>{if(confirm('Agree to copy shared chat and tasks? A custom database host can read this content. Sync pauses until copying completes.'))return Account.action('migration-accept',{id:change.id});}));
    if(change.status==='copying')row.append(btn('Continue copying',async()=>{for(let batch=0;batch<20;batch++){const result=await Account.action('migration-step',{id:change.id});status.textContent=`Copied ${result.checkpoint.counts.messages} messages and ${result.checkpoint.counts.tasks} tasks.`;if(result.status==='ready')break;} }));
    if(change.status==='ready')row.append(btn('Finish switch',()=>Account.action('migration-commit',{id:change.id})));
    if(['proposed','copying','ready'].includes(change.status))row.append(btn('Cancel switch',()=>Account.action('migration-cancel',{id:change.id})));
    if(change.status==='committed'&&state.migrations?.[0]?.id===change.id)row.append(btn('Request rollback',()=>Account.action('migration-propose',{backendId:change.previous_backend_id})));
    details.append(row);
   }
  }
  return details;
 }

 async function update(){const next=await Account.snapshot();if(next&&typeof next==='object'&&'capabilities'in next){state=next;render();}}
 const listener=()=>{if(el.isConnected&&!busy&&!el.contains(document.activeElement))void update();};window.addEventListener('baymax-account-changed',listener);
 const observer=new MutationObserver(()=>{if(!document.querySelector('.settings-surface')&&!el.isConnected){window.removeEventListener('baymax-account-changed',listener);observer.disconnect();}});queueMicrotask(()=>observer.observe(document.body,{childList:true,subtree:true}));
 el.append(content,status);render();void update();return el;
}
