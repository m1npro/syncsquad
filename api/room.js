import { neon } from '@neondatabase/serverless';
import { randomBytes, randomUUID, createHash, timingSafeEqual } from 'node:crypto';

const MAX_BODY = 30000;
const colors = ['#6268e8','#0e9fcb','#19a576','#ed9d36','#a36be8','#e46b92','#64748b','#0d9488'];
const roomPattern = /^SS-[A-F0-9]{12}$/;
const FIXED_ROOM='SS-220314000001';
const ALLOWED_MSSV=new Set(['DE220314','DE220280','DE220297']);
const statuses = ['todo','progress','review','done'];
const difficultyPoints = { easy:10, medium:25, hard:50 };
const safeStr = (s, max=200) => String(s ?? '').trim().slice(0,max);
const hash = (s) => createHash('sha256').update(s).digest('hex');
const fail = (res, code, message) => res.status(code).json({error:message});
const validId = (id) => typeof id === 'string' && /^[a-zA-Z0-9-]{8,90}$/.test(id);
const memberToken = () => randomBytes(32).toString('base64url');
function proofOK(value) {
  if (typeof value !== 'string' || value.length > 1800) return false;
  try {
    const u = new URL(value);
    if (u.protocol !== 'https:') return false;
    return ['github.com','www.github.com','drive.google.com','docs.google.com','figma.com','www.figma.com'].includes(u.hostname.toLowerCase());
  } catch { return false; }
}
function checkOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try { return new URL(origin).host === (req.headers['x-forwarded-host'] || req.headers.host); }
  catch { return false; }
}
function errorResponse(res, err) {
  console.error('SyncSquad database/API error',err?.code || err?.name || 'unknown');
  return fail(res,500,'Có lỗi máy chủ. Hãy thử lại sau.');
}
export default async function handler(req,res) {
  if (!process.env.DATABASE_URL) return fail(res,503,'Database chưa được cấu hình trên Vercel');
  if (!['GET','POST'].includes(req.method)) return fail(res,405,'Method không được hỗ trợ');
  if (req.method==='POST' && !checkOrigin(req)) return fail(res,403,'Origin không hợp lệ');
  const sql=neon(process.env.DATABASE_URL);
  try {
    if (req.method==='POST' && req.headers['content-length'] && Number(req.headers['content-length'])>MAX_BODY) return fail(res,413,'Dữ liệu quá lớn');
    const body = req.method==='POST' ? (req.body || {}) : {};
    if (typeof body !== 'object' || Array.isArray(body)) return fail(res,400,'Dữ liệu không hợp lệ');
    const action = safeStr(body.action,40);
    if(req.method==='POST' && action==='login') {
      const mssv=safeStr(body.mssv,20).toUpperCase();
      if(!ALLOWED_MSSV.has(mssv))return fail(res,403,'MSSV không nằm trong danh sách thành viên');
      const found=await sql`SELECT id,role,room_id FROM sync_members WHERE room_id=${FIXED_ROOM} AND mssv=${mssv} LIMIT 1`;
      if(!found.length)return fail(res,403,'MSSV không thuộc phòng cố định');
      const token=memberToken();
      await sql`INSERT INTO sync_sessions(token_hash,member_id,expires_at) VALUES (${hash(token)},${found[0].id},now()+interval '30 days')`;
      res.setHeader('Cache-Control','no-store');
      return res.status(200).json({roomId:FIXED_ROOM,memberId:found[0].id,token,role:found[0].role});
    }
    if(req.method==='POST' && action==='create')return fail(res,403,'Chỉ hỗ trợ phòng cố định; không thể tạo phòng khác');
    const roomId=req.method==='GET'?safeStr(req.query.room,40):safeStr(body.roomId,40);
    if (!roomPattern.test(roomId)||roomId!==FIXED_ROOM) return fail(res,403,'Chỉ hỗ trợ phòng cố định');
    const token = (req.headers.authorization||'').replace(/^Bearer\s+/i,'').trim();
    if(!token || token.length>300) return fail(res,401,'Bạn cần đăng nhập bằng link mời riêng');
    const tokenHash=hash(token);
    const authorized=await sql`SELECT m.id,m.name,m.role,m.color,m.mssv FROM sync_members m JOIN sync_sessions s ON s.member_id=m.id WHERE m.room_id=${roomId} AND m.mssv=ANY(ARRAY['DE220314','DE220280','DE220297']) AND s.token_hash=${tokenHash} AND s.expires_at>now() LIMIT 1`;
    if(authorized.length===0) return fail(res,403,'Link mời không hợp lệ hoặc đã được thu hồi');
    const actor=authorized[0];
    if(req.method==='GET') {
      const [rooms,members,busy,tasks]=await Promise.all([
        sql`SELECT id,name,subject,created_at FROM sync_rooms WHERE id=${roomId}`,
        sql`SELECT id,name,role,color,mssv FROM sync_members WHERE room_id=${roomId} AND mssv=ANY(ARRAY['DE220314','DE220280','DE220297']) ORDER BY created_at,id`,
        sql`SELECT member_id,day,slot FROM sync_busy WHERE room_id=${roomId}`,
        sql`SELECT id,title,description,assignee_id,points,difficulty,deadline,status,proof_url,verified_by,verified_at,created_at FROM sync_tasks WHERE room_id=${roomId} ORDER BY created_at DESC`]);
      if(!rooms.length) return fail(res,404,'Không tìm thấy phòng');
      res.setHeader('Cache-Control','no-store');
      return res.status(200).json({room:rooms[0],me:actor,members,busy,tasks});
    }
    if(action==='busy_batch') {
      const cells=body.cells;
      if(!Array.isArray(cells)||cells.length<1||cells.length>42||typeof body.busy!=='boolean')return fail(res,400,'Danh sách ca học không hợp lệ');
      const checked=[];
      for(const c of cells){const day=Number(c.day),slot=Number(c.slot);if(!Number.isInteger(day)||day<0||day>6||!Number.isInteger(slot)||slot<0||slot>5)return fail(res,400,'Ngày hoặc slot không hợp lệ');checked.push({day,slot});}
      const unique=[...new Map(checked.map(c=>[c.day+'-'+c.slot,c])).values()];
      const operations=unique.map(c=>body.busy
        ? sql`INSERT INTO sync_busy(room_id,member_id,day,slot) VALUES (${roomId},${actor.id},${c.day},${c.slot}) ON CONFLICT DO NOTHING`
        : sql`DELETE FROM sync_busy WHERE room_id=${roomId} AND member_id=${actor.id} AND day=${c.day} AND slot=${c.slot}`);
      await sql.transaction(operations);
      return res.status(200).json({ok:true,count:unique.length});
    }
    if(action==='busy') {
      const day=Number(body.day),slot=Number(body.slot);
      if(!Number.isInteger(day)||day<0||day>6||!Number.isInteger(slot)||slot<0||slot>5) return fail(res,400,'Ngày hoặc ca học không hợp lệ');
      if(body.busy===true) await sql`INSERT INTO sync_busy(room_id,member_id,day,slot) VALUES (${roomId},${actor.id},${day},${slot}) ON CONFLICT DO NOTHING`;
      else if(body.busy===false) await sql`DELETE FROM sync_busy WHERE room_id=${roomId} AND member_id=${actor.id} AND day=${day} AND slot=${slot}`;
      else return fail(res,400,'Trạng thái lịch bận không hợp lệ');
      return res.status(200).json({ok:true});
    }
    if(action==='task_create') {
      const title=safeStr(body.title,160), description=safeStr(body.description,1000),difficulty=safeStr(body.difficulty,20);
      const points=difficultyPoints[difficulty];
      if(!title||!points) return fail(res,400,'Tên task hoặc độ khó không hợp lệ');
      const assignee=safeStr(body.assigneeId,90) || null;
      if(assignee) { const match=await sql`SELECT id FROM sync_members WHERE room_id=${roomId} AND id=${assignee}`;if(!match.length)return fail(res,400,'Thành viên phụ trách không hợp lệ'); }
      const deadline=body.deadline ? safeStr(body.deadline,10) : null;
      if(deadline && !/^\d{4}-\d{2}-\d{2}$/.test(deadline))return fail(res,400,'Deadline không hợp lệ');
      const id=randomUUID();
      await sql`INSERT INTO sync_tasks(id,room_id,title,description,assignee_id,difficulty,points,deadline) VALUES (${id},${roomId},${title},${description},${assignee},${difficulty},${points},${deadline})`;
      return res.status(201).json({ok:true,id});
    }
    if(action==='task_edit') {
      const id=safeStr(body.id,90), title=safeStr(body.title,160),description=safeStr(body.description,1000),difficulty=safeStr(body.difficulty,20),assignee=safeStr(body.assigneeId,90)||null,deadline=body.deadline?safeStr(body.deadline,10):null;
      if(!validId(id)||!title||!difficultyPoints[difficulty])return fail(res,400,'Dữ liệu task không hợp lệ');
      const current=await sql`SELECT status FROM sync_tasks WHERE id=${id} AND room_id=${roomId}`;
      if(!current.length)return fail(res,404,'Không có task');
      if(current[0].status==='done')return fail(res,409,'Task đã xác minh không thể chỉnh sửa');
      if(assignee){const m=await sql`SELECT id FROM sync_members WHERE room_id=${roomId} AND id=${assignee}`;if(!m.length)return fail(res,400,'Người phụ trách không thuộc phòng');}
      if(deadline&&!/^\d{4}-\d{2}-\d{2}$/.test(deadline))return fail(res,400,'Deadline không hợp lệ');
      await sql`UPDATE sync_tasks SET title=${title},description=${description},assignee_id=${assignee},difficulty=${difficulty},points=${difficultyPoints[difficulty]},deadline=${deadline},updated_at=now() WHERE id=${id} AND room_id=${roomId} AND status<>'done'`;
      return res.status(200).json({ok:true});
    }
    if(action==='task_status') {
      const id=safeStr(body.id,90), status=safeStr(body.status,20);
      if(!validId(id)||!statuses.includes(status))return fail(res,400,'Trạng thái không hợp lệ');
      if(status==='done') return fail(res,409,'Chỉ hoàn thành qua chức năng Duyệt task');
      const current=await sql`SELECT status,proof_url,assignee_id FROM sync_tasks WHERE room_id=${roomId} AND id=${id}`;
      if(!current.length)return fail(res,404,'Không tìm thấy task');
      if(current[0].status==='done')return fail(res,409,'Task đã xác minh không được thay đổi trạng thái');
      if(status==='review') {
        const proof=safeStr(body.proof||current[0].proof_url,1800);
        if(!proofOK(proof))return fail(res,400,'Cần link HTTPS GitHub, Google Drive hoặc Figma');
        if(!current[0].assignee_id)return fail(res,400,'Cần phân công người phụ trách trước khi chờ duyệt');
        await sql`UPDATE sync_tasks SET status='review',proof_url=${proof},verified_by=NULL,verified_at=NULL,updated_at=now() WHERE room_id=${roomId} AND id=${id} AND status<>'done'`;
      }else await sql`UPDATE sync_tasks SET status=${status},verified_by=NULL,verified_at=NULL,updated_at=now() WHERE room_id=${roomId} AND id=${id} AND status<>'done'`;
      return res.status(200).json({ok:true});
    }
    if(action==='verify') {
      const id=safeStr(body.id,90);
      if(!validId(id))return fail(res,400,'Task ID không hợp lệ');
      const updated=await sql`UPDATE sync_tasks SET status='done',verified_by=${actor.id},verified_at=now(),updated_at=now() WHERE id=${id} AND room_id=${roomId} AND status='review' AND assignee_id IS NOT NULL AND assignee_id<>${actor.id} AND proof_url<>'' RETURNING id`;
      if(!updated.length)return fail(res,409,'Chỉ thành viên khác người thực hiện mới có thể duyệt task ở trạng thái Review');
      return res.status(200).json({ok:true});
    }
    if(action==='roulette') {
      const candidates=await sql`SELECT id FROM sync_tasks WHERE room_id=${roomId} AND assignee_id IS NULL AND status='todo' ORDER BY id`;
      const members=await sql`SELECT id FROM sync_members WHERE room_id=${roomId} ORDER BY id`;
      if(!candidates.length || !members.length)return fail(res,409,'Không có task chưa ai nhận');
      const task=candidates[Math.floor(Math.random()*candidates.length)],chosen=members[Math.floor(Math.random()*members.length)];
      const done=await sql`UPDATE sync_tasks SET assignee_id=${chosen.id},updated_at=now() WHERE id=${task.id} AND room_id=${roomId} AND assignee_id IS NULL RETURNING id,title`;
      if(!done.length)return fail(res,409,'Task vừa được thành viên khác nhận, hãy quay lại');
      return res.status(200).json({ok:true,taskId:task.id,memberId:chosen.id,title:done[0].title});
    }
    if(action==='room_edit') {
      if(actor.role!=='admin'||actor.mssv!=='DE220314')return fail(res,403,'Chỉ host DE220314 được sửa phòng');
      const group=safeStr(body.group,100),subject=safeStr(body.subject,100);
      if(!group||!subject)return fail(res,400,'Nhập tên nhóm và môn học');
      await sql`UPDATE sync_rooms SET name=${group},subject=${subject},updated_at=now() WHERE id=${roomId}`;
      return res.status(200).json({ok:true});
    }
    if(action==='member_add')return fail(res,403,'Danh sách MSSV cố định, không thể thêm thành viên');
    if(action==='member_invite')return fail(res,403,'Thành viên tham gia bằng MSSV, không dùng link mời');
    return fail(res,404,'Tác vụ không được hỗ trợ');
  } catch(err){return errorResponse(res,err);}
}