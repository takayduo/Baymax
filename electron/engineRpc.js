const http = require('node:http');
const { randomBytes, timingSafeEqual } = require('node:crypto');

// A per-launch capability inherited only by Baymax's Python children. The
// Electron process owns persistence; Python never rewrites its JSON stores.
async function startEngineRpc(handle) {
  const token = randomBytes(32).toString('hex'), results = new Map();
  const server = http.createServer(async (req,res) => {
    const supplied = Buffer.from((req.headers.authorization || '').replace(/^Bearer /,''));
    const expected = Buffer.from(token);
    if (req.method !== 'POST' || req.url !== '/action' || supplied.length !== expected.length || !timingSafeEqual(supplied,expected)) { res.writeHead(403).end(); return; }
    try {
      let body=''; for await (const chunk of req) { body+=chunk; if(body.length>65536) throw new Error('Request too large'); }
      const {id,action,parameters}=JSON.parse(body);
      if(typeof id !== 'string' || id.length>100 || !parameters || typeof parameters!=='object') throw new Error('Invalid command');
      const now=Date.now();for(const [key,value] of results) if(now-value.at>300000) results.delete(key);
      if(!results.has(id)) results.set(id,{at:now,promise:Promise.resolve().then(()=>handle(action,parameters)).then(data=>({success:true,data}),e=>({success:false,error:e.message}))});
      res.setHeader('Content-Type','application/json');res.end(JSON.stringify(await results.get(id).promise));
    } catch(e) { res.writeHead(400,{'Content-Type':'application/json'}).end(JSON.stringify({success:false,error:e.message})); }
  });
  server.requestTimeout=15000;
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  process.env.BAYMAX_RPC_URL=`http://127.0.0.1:${server.address().port}/action`;
  process.env.BAYMAX_RPC_TOKEN=token;
  server.unref();return server;
}
module.exports={startEngineRpc};
