import { NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import { createHmac } from 'node:crypto';
import { importPKCS8, SignJWT } from 'jose';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const env=name=>{const v=process.env[name];if(!v)throw new Error('Missing '+name);return v};
const hash=value=>createHmac('sha256',env('LICENSE_PEPPER')).update(value).digest('hex');
const deny=(reason,status=403)=>NextResponse.json({status:'denied',reason},{status,headers:{'Cache-Control':'no-store'}});
export async function POST(request){
 let input;
 try{input=await request.json()}catch{return deny('bad_request',400)}
 if(!input||typeof input!=='object')return deny('bad_request',400);
 const licenseKey=typeof input.licenseKey==='string'?input.licenseKey.toUpperCase().replace(/[^A-Z0-9]/g,''):'';
 const installId=typeof input.installId==='string'?input.installId:'';
 const deviceName=typeof input.deviceName==='string'?input.deviceName.slice(0,80):'';
 if(!/^MINPRO[A-Z2-9]{26}$/.test(licenseKey)||!/^[a-f0-9-]{36}$/i.test(installId))return deny('bad_request',400);
 try{
  const sql=neon(env('DATABASE_URL'));
  const ip=(request.headers.get('x-vercel-forwarded-for')||'local').split(',')[0].trim();
  const bucket=hash('ip:'+ip);
  const limits=await sql.query("INSERT INTO rate_buckets (bucket,attempts,window_start) VALUES ($1,1,now()) ON CONFLICT (bucket) DO UPDATE SET attempts=CASE WHEN rate_buckets.window_start<now()-interval '10 minutes' THEN 1 ELSE rate_buckets.attempts+1 END,window_start=CASE WHEN rate_buckets.window_start<now()-interval '10 minutes' THEN now() ELSE rate_buckets.window_start END RETURNING attempts",[bucket]);
  if(Number(limits[0].attempts)>12)return deny('too_many_requests',429);
  const records=await sql.query("SELECT * FROM activate_minpro_license($1,$2,$3)",[hash('license:'+licenseKey),hash('device:'+installId),deviceName]);
  const r=records[0];
  if(!r||r.code!=='ok')return deny(String(r?.code||'invalid_key'));
  const now=Math.floor(Date.now()/1000);
  const exp=Math.min(now+300,r.license_expiry?Math.floor(new Date(r.license_expiry).getTime()/1000):Number.MAX_SAFE_INTEGER);
  if(exp<=now)return deny('expired');
  const key=await importPKCS8(env('LICENSE_SIGNING_KEY_PEM').replace(/\\n/g,'\n'),'ES256');
  const token=await new SignJWT({installId,licenseId:r.license_id}).setProtectedHeader({alg:'ES256',typ:'JWT'}).setIssuedAt().setIssuer(process.env.LICENSE_ISSUER||'minpro-license-api').setAudience(process.env.LICENSE_AUDIENCE||'autonth-minpro').setExpirationTime(exp).sign(key);
  return NextResponse.json({status:'ok',token,sessionExpiresAt:new Date(exp*1000).toISOString(),licenseExpiresAt:r.license_expiry,maxDevices:r.device_limit},{headers:{'Cache-Control':'no-store'}});
 }catch(e){console.error('License server error',e instanceof Error?e.name:'unknown');return deny('server_error',500)}
}