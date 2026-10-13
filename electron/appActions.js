// One bounded contract for Gemini Live RPC and REST response action tags.
const musicActions=['play','pause','resume','next','previous','volume','add_shared','join','leave'];
const views=['music','chat','tasks','share','productivity','settings','partner_chat'];
const emotes=['love','celebrate','vibe','dizzy','sleepy'];
function cleanAppAction(value) {
  if(!value || typeof value!=='object')throw new Error('App action required');
  const action=String(value.action||'');
  if(action==='music'){
    if(!musicActions.includes(value.command))throw new Error('Unknown music command');
    const query=String(value.query||'').trim();if(query.length>200)throw new Error('Song query too long');
    if(value.command==='volume' && (!Number.isFinite(value.volume)||value.volume<0||value.volume>100))throw new Error('Volume must be 0–100');
    return {action,command:value.command,query,volume:value.volume};
  }
  if(action==='open_view' && views.includes(value.view))return {action,view:value.view};
  if(action==='emote' && emotes.includes(value.emote))return {action,emote:value.emote};
  throw new Error('Unknown app action');
}
module.exports={cleanAppAction};
