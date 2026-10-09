function parseActionTags(text) {
  const actions=[],ranges=[]; const marker=/\[([A-Z_]+)(?::\s*|\])/g;let match;
  while((match=marker.exec(text))) {
    const name=match[1], start=match.index;let end=marker.lastIndex,value='';
    if(match[0].endsWith(']')) { actions.push({name,value});ranges.push([start,end]);continue; }
    if(text[end]==='{') {
      const begin=end;let depth=0,quoted=false,escaped=false;
      for(;end<text.length;end++) {
        const c=text[end];if(escaped){escaped=false;continue;}if(quoted&&c==='\\'){escaped=true;continue;}if(c==='"'){quoted=!quoted;continue;}if(quoted)continue;
        if(c==='{')depth++;if(c==='}'&&--depth===0){end++;break;}
      }
      value=JSON.parse(text.slice(begin,end));while(/\s/.test(text[end] || '')&&end<text.length)end++;
      if(text[end]!==']')throw new Error('Malformed action request');end++;
    } else {const stop=text.indexOf(']',end);if(stop<0)throw new Error('Incomplete action request');value=text.slice(end,stop).trim();end=stop+1;}
    actions.push({name,value});ranges.push([start,end]);marker.lastIndex=end;
  }
  let clean=text;for(const [a,b] of ranges.reverse())clean=clean.slice(0,a)+clean.slice(b);
  const unique=new Map(actions.map(a=>[JSON.stringify(a),a]));
  return {actions:[...unique.values()],text:clean.trim()};
}
function resolveRole(value,current) { const role=String(value || current).toLowerCase();return ['me','her','both'].includes(role)?role:role==='partner'?(current==='me'?'her':'me'):current; }
module.exports={parseActionTags,resolveRole};
