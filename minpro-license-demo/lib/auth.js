import {neon} from '@neondatabase/serverless';
import {createHmac,scryptSync,timingSafeEqual,randomInt} from 'node:crypto';
import {SignJWT,jwtVerify} from 'jose';
import {NextResponse} from 'next/server';
const need=k=>{if(!process.env[k])throw Error(k+' missing');return process.env[k]};
export const db=()=>neon(need('DATABASE_URL'));
export const digest=s=>createHmac('sha256',need('LICENSE_PEPPER')).update(s).digest('hex');
export const ip=req=>(req.headers.get('x-forwarded-for')||'').split(',')[0].trim()||null;
export const origin=req=>{const o=req.headers.get('origin');return !!o&&o===new URL(req.url).origin};
export const passhash=(p,s)=>scryptSync(p,Buffer.from(s,'hex'),64,{N:16384,r:8,p:1}).toString('hex');
export const validpass=(p,s,h)=>{let a=Buffer.from(passhash(p,s),'hex'),b=Buffer.from(h,'hex');return a.length===b.length&&timingSafeEqual(a,b)};
const secret=()=>new TextEncoder().encode(need('ADMIN_SESSION_SECRET'));
export const sign=async(u,v)=>new SignJWT({v}).setProtectedHeader({alg:'HS256'}).setIssuer('minpro-admin').setAudience('minpro-admin').setSubject(u).setIssuedAt().setExpirationTime('2h').sign(secret());
export async function session(cookie){
 if(!cookie)return null;
 try{
  const {payload}=await jwtVerify(cookie,secret(),{issuer:'minpro-admin',audience:'minpro-admin'});
  if(typeof payload.sub!=='string'||! /^[A-Za-z0-9_-]{3,64}$/.test(payload.sub)||!Number.isInteger(payload.v))return null;
  const rows=await db().query('SELECT username,must_change,session_version FROM admin_accounts WHERE username=$1',[payload.sub]);
  return rows[0]?.session_version===payload.v?rows[0]:null;
 }catch{return null}
}
export const redir=(req,path)=>NextResponse.redirect(new URL(path,req.url),303);
export const cookieOpt={httpOnly:true,secure:true,sameSite:'strict',path:'/',maxAge:7200};
export async function limit(bucket,max,minutes){const r=await db().query("INSERT INTO rate_buckets(bucket,attempts,window_start) VALUES ($1,1,now()) ON CONFLICT(bucket) DO UPDATE SET attempts=CASE WHEN rate_buckets.window_start<now()-($2::int*interval '1 minute') THEN 1 ELSE rate_buckets.attempts+1 END,window_start=CASE WHEN rate_buckets.window_start<now()-($2::int*interval '1 minute') THEN now() ELSE rate_buckets.window_start END RETURNING attempts",[bucket,minutes]);return +r[0].attempts<=max}
export function newKey(){const alpha='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';const v=Array.from({length:26},()=>alpha[randomInt(alpha.length)]).join('');return ['MINPRO',v.slice(0,5),v.slice(5,10),v.slice(10,15),v.slice(15,20),v.slice(20)].join('-')}