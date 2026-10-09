const path = require('node:path');
const { pathToFileURL } = require('node:url');
function registerAppScheme(protocol) {
  protocol.registerSchemesAsPrivileged([{ scheme:'baymax', privileges:{standard:true,secure:true,supportFetchAPI:true,corsEnabled:true,stream:true} }]);
}
function installAppProtocol(protocol, net, root) {
  protocol.handle('baymax', async request => {
    const url=new URL(request.url);
    if(url.hostname!=='app')return new Response('Not found',{status:404});
    let relative;
    try { relative=decodeURIComponent(url.pathname).replace(/^\/+/, ''); }
    catch { return new Response('Bad request',{status:400}); }
    let base=path.join(root,'dist');
    if(relative.startsWith('productivity/')) {relative=relative.slice(13);base=path.join(root,'productivity','dist');}
    const resolved=path.resolve(base,relative || 'index.html');
    if(!resolved.startsWith(base+path.sep) || !/\.(html|js|css|png|svg|ico|jpg|jpeg|webp|woff2?|json|wav|mp3|ogg)$/i.test(resolved)) return new Response('Not found',{status:404});
    try {
      const response=await net.fetch(pathToFileURL(resolved).href),headers=new Headers(response.headers);
      // Sandboxed Productivity has an opaque origin. Only public build assets
      // are available here; privileged commands go through the scoped RPC.
      headers.set('Access-Control-Allow-Origin','*');
      return new Response(response.body,{status:response.status,headers});
    } catch { return new Response('Not found',{status:404}); }
  });
}
module.exports={registerAppScheme,installAppProtocol};
