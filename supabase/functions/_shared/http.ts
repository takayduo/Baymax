import { createClient } from 'npm:@supabase/supabase-js@2.117.2';
export const env=(key:string)=>Deno.env.get(key)||'';
export const admin=()=>createClient(env('SUPABASE_URL'),env('SUPABASE_SERVICE_ROLE_KEY'),{auth:{persistSession:false,autoRefreshToken:false}});
export const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json','access-control-allow-origin':'*','cache-control':'no-store'}});
export function checked<R extends {data:unknown,error:any}>(result:R):R['data'] {if(result.error)throw new Error(result.error.message);return result.data;}
export async function identity(req:Request,db=admin()){
 const token=(req.headers.get('authorization')||'').replace(/^Bearer /i,'');
 if(!token || token.length>12000)throw new Error('Sign in required');
 const {data,error}=await db.auth.getUser(token);if(error || !data.user)throw new Error('Sign in required');
 if(!(data.user.app_metadata?.providers||[data.user.app_metadata?.provider]).includes('google'))throw new Error('Sign in required');
 return {user:data.user,token,db};
}
export async function body(req:Request){
 if(req.method!=='POST')throw new Error('POST required');
 const raw=await req.text();if(raw.length>64000)throw new Error('Request too large');
 const data=JSON.parse(raw||'{}');if(!data || Array.isArray(data) || typeof data!=='object')throw new Error('Invalid request');return data;
}
export const uuid=(value:unknown)=>{if(typeof value!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value))throw new Error('Invalid ID');return value;};
export const username=(value:unknown)=>{const text=String(value||'').replace(/^@/,'').trim().toLowerCase();if(!/^[a-z0-9_]{3,24}$/.test(text))throw new Error('Use 3–24 letters, numbers or underscores');return text;};
export const text=(value:unknown,max:number)=>{if(typeof value!=='string'||value.length>max)throw new Error('Invalid text');return value.trim();};
export const hash=async(value:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))).map(n=>n.toString(16).padStart(2,'0')).join('');
export function randomToken(){return Array.from(crypto.getRandomValues(new Uint8Array(32))).map(n=>n.toString(16).padStart(2,'0')).join('');}
export const endpoint=(value:unknown)=>{const v=String(value||'');if(!/^https:\/\/[a-z0-9-]+\.supabase\.co\/functions\/v1\/custom-adapter$/.test(v))throw new Error('Use your Supabase custom-adapter endpoint');return v;};
export function serve(handler:(req:Request)=>Promise<unknown>){return async(req:Request)=>{
 if(req.method==='OPTIONS')return new Response(null,{headers:{'access-control-allow-origin':'*','access-control-allow-headers':'authorization,apikey,content-type','access-control-allow-methods':'POST,OPTIONS'}});
 try{return json(await handler(req));}catch(e){const message=e instanceof Error?e.message:'Request failed';return json({error:message},message==='Sign in required'?401:400);}
};}
