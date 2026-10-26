import { neon } from '@neondatabase/serverless';
import { randomBytes, randomUUID, createHash, timingSafeEqual, scryptSync } from 'node:crypto';

const MAX_BODY=30000;
const roomPattern=/^SS-[A-F0-9]{12}$/;
const colors=['#6268e8','#0e9fcb','#19a576','#ed9d36','#a36be8','#e46b92','#64748b','#0d9488'];
const statuses=['todo','progress','review','done'];
const difficultyPoints={easy:10,medium:25,hard:50};
const safeStr=(s,max=200)=>String(s??'').trim().slice(0,max);
const hash=s=>createHash('sha256').update(s).digest('hex');
const memberToken=()=>randomBytes(32).toString('base64url');
const pinDigest=(pin,salt)=>scryptSync(pin,salt,32).toString('hex');
const fail=(res,code,message)=>res.status(code).json({error:message});
const validId=id=>typeof id==='string'&&/^[a-zA-Z0-9-]{8,90}$/.test(id);
function proofOK(value){
 if(typeof value!=='string'||value.length>1800)return false;
 try{const u=new URL(value);return u.protocol==='https:'&&['github.com','www.github.com','drive.google.com','docs.google.com','figma.com','www.figma.com'].includes(u.hostname.toLowerCase())}catch{return false}
}
function checkOrigin(req){
 const origin=req.headers.origin;
 if(!origin)return true;
 try{return new URL(origin).host===(req.headers['x-forwarded-host']||req.headers.host)}catch{return false}
}
function errorResponse(res,err){
 const code=err?.code||'';
 console.error('SyncSquad database/API error',code,err?.constraint||'');
 if(code==='23502')return fail(res,409,'Một trường dữ liệu bắt buộc đang bị thiếu. Vui lòng tải lại trang, chọn đúng đồ án và thử lại.');
 if(code==='23503')return fail(res,409,'Dữ liệu liên kết không còn hợp lệ. Hãy làm mới phòng hoặc chọn lại người phụ trách.');
 if(code==='23505')return fail(res,409,'Dữ liệu bị trùng. Hãy làm mới danh sách trước khi thử lại.');
 if(code==='23514'||code==='22P02'||code==='22007')return fail(res,400,'Thông tin không hợp lệ. Kiểm tra nội dung và ngày hạn của nhiệm vụ.');
 return fail(res,500,'Máy chủ đang gặp lỗi. Vui lòng thử lại sau.');
}
function namesFrom(value){
 if(!Array.isArray(value)||value.length<3||value.length>8)return null;
 const names=value.map(n=>safeStr(n,65));
 if(names.some(n=>n.length<2||n.length>65||/[\r\n\t<>]/.test(n)))return null;
 if(new Set(names.map(n=>n.toLocaleLowerCase('vi-VN'))).size!==names.length)return null;
 return names;
}
export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store');
 if(!process.env.DATABASE_URL)return fail(res,503,'Database chưa được cấu hình trên Vercel');
 if(!['GET','POST'].includes(req.method))return fail(res,405,'Method không được hỗ trợ');
 if(req.method==='POST'&&!checkOrigin(req))return fail(res,403,'Origin không hợp lệ');
 const sql=neon(process.env.DATABASE_URL);
 try{
  if(req.method==='POST'&&req.headers['content-length']&&Number(req.headers['content-length'])>MAX_BODY)return fail(res,413,'Dữ liệu quá lớn');
  const body=req.method==='POST'?(req.body||{}):{};
  if(typeof body!=='object'||Array.isArray(body))return fail(res,400,'Dữ liệu không hợp lệ');
  const action=safeStr(body.action,40);

  // Anyone may create their own room. The first member becomes its admin.
  // The room and member records are inserted in a single transaction.
  if(req.method==='POST'&&action==='create'){
    const name=safeStr(body.group,100),subject=safeStr(body.subject,100);
    const names=namesFrom(body.members);
    const pin=safeStr(body.pin,10);
    if(!name||!subject||!names)return fail(res,400,'Nhập tên nhóm, môn học và 3–8 thành viên có tên khác nhau');
    if(!/^\d{4}$/.test(pin))return fail(res,400,'Trưởng nhóm cần đặt mã PIN gồm đúng 4 số');
    const newRoomId='SS-'+randomBytes(6).toString('hex').toUpperCase();
    const hostId=randomUUID(),salt=randomBytes(16).toString('hex'),hashed=pinDigest(pin,salt),token=memberToken();
    const memberIds=names.map((_,i)=>i===0?hostId:randomUUID());
    const defaultProjectId='prj-'+newRoomId;
    const operations=[
      sql`INSERT INTO sync_rooms(id,name,subject) VALUES (${newRoomId},${name},${subject})`,
      ...names.map((memberName,i)=>sql`INSERT INTO sync_members(id,room_id,name,role,token_hash,color,pin_hash,pin_salt,claimed_at)
        VALUES (${memberIds[i]},${newRoomId},${memberName},${i===0?'admin':'member'},${hash(memberToken())},${colors[i%colors.length]},${i===0?hashed:null},${i===0?salt:null},${i===0?new Date():null})`),
      sql`INSERT INTO sync_projects(id,room_id,name,description,is_default,created_by)
        VALUES (${defaultProjectId},${newRoomId},'Đồ án chính','Đồ án đầu tiên trong nhóm',true,${hostId})`,
      sql`INSERT INTO sync_sessions(token_hash,member_id,expires_at) VALUES (${hash(token)},${hostId},now()+interval '90 days')`
    ];
    await sql.transaction(operations);
    return res.status(201).json({roomId:newRoomId,memberId:hostId,token,role:'admin'});
  }

  const roomId=req.method==='GET'?safeStr(req.query.room,40):safeStr(body.roomId,40);
  if(!roomPattern.test(roomId))return fail(res,400,'Mã phòng không hợp lệ');

  // Public room roster for the SINGLE shared invite URL; do not expose tasks or tokens.
  if(req.method==='GET'&&req.query.public==='1'){
    const [rooms,members]=await Promise.all([
      sql`SELECT id,name,subject FROM sync_rooms WHERE id=${roomId}`,
      sql`SELECT id,name,role,color,(claimed_at IS NOT NULL) AS claimed
          FROM sync_members WHERE room_id=${roomId} ORDER BY created_at,id`
    ]);
    if(!rooms.length)return fail(res,404,'Không tìm thấy phòng này');
    return res.status(200).json({room:rooms[0],members});
  }

  // Claiming is an atomic UPDATE ... WHERE claimed_at IS NULL.
  // Even simultaneous requests can never claim the same identity twice.
  if(req.method==='POST'&&(action==='claim'||action==='pin_login')){
    const memberId=safeStr(body.memberId,90),pin=safeStr(body.pin,10);
    if(!validId(memberId)||!/^\d{4}$/.test(pin))return fail(res,400,'Chọn tên và nhập mã PIN gồm 4 chữ số');
    const found=await sql`SELECT id,role,claimed_at,pin_hash,pin_salt,pin_failures,lock_until
      FROM sync_members WHERE id=${memberId} AND room_id=${roomId} LIMIT 1`;
    if(!found.length)return fail(res,404,'Không có thành viên này trong phòng');
    const m=found[0];
    if(action==='claim'){
      if(m.claimed_at)return fail(res,409,'Tên này đã được nhận. Nếu là bạn, hãy đăng nhập bằng mã PIN.');
      const salt=randomBytes(16).toString('hex'),digest=pinDigest(pin,salt);
      const changed=await sql`UPDATE sync_members SET pin_hash=${digest},pin_salt=${salt},claimed_at=now(),
        pin_failures=0,lock_until=NULL WHERE id=${memberId} AND room_id=${roomId}
        AND claimed_at IS NULL RETURNING id,role`;
      if(!changed.length)return fail(res,409,'Tên vừa được thành viên khác nhận; vui lòng tải lại danh sách.');
    }else{
      if(!m.claimed_at||!m.pin_hash||!m.pin_salt)return fail(res,409,'Tên này chưa được nhận. Hãy đặt PIN lần đầu.');
      if(m.lock_until&&new Date(m.lock_until).getTime()>Date.now())return fail(res,429,'Đã nhập sai PIN quá nhiều. Hãy thử lại sau 15 phút.');
      const expected=Buffer.from(m.pin_hash,'hex'),actual=Buffer.from(pinDigest(pin,m.pin_salt),'hex');
      if(expected.length!==actual.length||!timingSafeEqual(expected,actual)){
        await sql`UPDATE sync_members SET pin_failures=pin_failures+1,
          lock_until=CASE WHEN pin_failures+1>=5 THEN now()+interval '15 minutes' ELSE lock_until END
          WHERE id=${memberId} AND room_id=${roomId}`;
        return fail(res,401,'Mã PIN không chính xác');
      }
      await sql`UPDATE sync_members SET pin_failures=0,lock_until=NULL WHERE id=${memberId} AND room_id=${roomId}`;
    }
    const token=memberToken();
    await sql`INSERT INTO sync_sessions(token_hash,member_id,expires_at)
        VALUES (${hash(token)},${memberId},now()+interval '90 days')`;
    return res.status(200).json({roomId,memberId,token,role:m.role});
  }

  const token=(req.headers.authorization||'').replace(/^Bearer\s+/i,'').trim();
  if(!token||token.length>300)return fail(res,401,'Vui lòng chọn tên và đăng nhập để tiếp tục');
  const authorized=await sql`SELECT m.id,m.name,m.role,m.color
    FROM sync_members m JOIN sync_sessions s ON s.member_id=m.id
    WHERE m.room_id=${roomId} AND s.token_hash=${hash(token)} AND s.expires_at>now()
    LIMIT 1`;
  if(!authorized.length)return fail(res,401,'Phiên đăng nhập đã hết hạn. Hãy chọn tên và đăng nhập lại.');
  const actor=authorized[0];


  if(req.method==='GET'){
    const [rooms,members,busy,projects]=await Promise.all([
      sql`SELECT id,name,subject,created_at FROM sync_rooms WHERE id=${roomId}`,
      sql`SELECT id,name,role,color,(claimed_at IS NOT NULL) AS claimed FROM sync_members
        WHERE room_id=${roomId} ORDER BY created_at,id`,
      sql`SELECT member_id,day,slot FROM sync_busy WHERE room_id=${roomId}`,
      sql`SELECT p.id,p.name,p.description,p.is_default,p.created_at,
          COUNT(t.id)::integer AS task_count,
          COUNT(t.id) FILTER (WHERE t.status='done')::integer AS done_count
        FROM sync_projects p LEFT JOIN sync_tasks t ON t.project_id=p.id
        WHERE p.room_id=${roomId}
        GROUP BY p.id ORDER BY p.is_default DESC,p.created_at,p.id`
    ]);
    if(!rooms.length)return fail(res,404,'Không tìm thấy phòng');
    const requested=safeStr(req.query.project,90);
    const activeProject=projects.find(p=>p.id===requested)||projects.find(p=>p.is_default)||projects[0];
    if(!activeProject)return fail(res,409,'Phòng chưa được khởi tạo đồ án');
    const tasks=await sql`SELECT id,title,description,assignee_id,points,difficulty,deadline,status,proof_url,
        verified_by,verified_at,created_at,project_id FROM sync_tasks
        WHERE room_id=${roomId} AND project_id=${activeProject.id} ORDER BY created_at DESC`;
    return res.status(200).json({room:rooms[0],me:actor,members,busy,projects,activeProjectId:activeProject.id,tasks});
  }
  if(action==='logout'){
    await sql`DELETE FROM sync_sessions WHERE token_hash=${hash(token)}`;
    return res.status(200).json({ok:true});
  }

  if(action==='project_create'){
    if(actor.role!=='admin')return fail(res,403,'Chỉ trưởng nhóm mới được tạo đồ án');
    const name=safeStr(body.name,100),description=safeStr(body.description,600);
    if(name.length<2)return fail(res,400,'Tên đồ án phải có ít nhất 2 ký tự');
    const counts=await sql`SELECT COUNT(*)::integer AS n FROM sync_projects WHERE room_id=${roomId}`;
    if(counts[0].n>=30)return fail(res,409,'Một nhóm có tối đa 30 đồ án');
    const projectId=randomUUID();
    const inserted=await sql`INSERT INTO sync_projects(id,room_id,name,description,created_by)
      VALUES (${projectId},${roomId},${name},${description},${actor.id})
      ON CONFLICT DO NOTHING RETURNING id,name`;
    if(!inserted.length)return fail(res,409,'Tên đồ án đã tồn tại trong nhóm');
    return res.status(201).json({ok:true,projectId:inserted[0].id,name:inserted[0].name});
  }
  if(action==='project_edit'){
    if(actor.role!=='admin')return fail(res,403,'Chỉ trưởng nhóm mới được sửa đồ án');
    const projectId=safeStr(body.projectId,90),name=safeStr(body.name,100),description=safeStr(body.description,600);
    if(!validId(projectId)||name.length<2)return fail(res,400,'Tên hoặc mã đồ án không hợp lệ');
    const changed=await sql`UPDATE sync_projects SET name=${name},description=${description},updated_at=now()
      WHERE id=${projectId} AND room_id=${roomId}
      AND NOT EXISTS(SELECT 1 FROM sync_projects other
        WHERE other.room_id=${roomId} AND lower(other.name)=lower(${name}) AND other.id<>${projectId})
      RETURNING id`;
    if(!changed.length)return fail(res,409,'Không tìm thấy đồ án hoặc tên đã tồn tại');
    return res.status(200).json({ok:true});
  }
  // Scope every task mutation to an existing project in the actor's room.
  const projectAction=['task_create','task_edit','task_status','verify','roulette'].includes(action);
  const projectId=safeStr(body.projectId,90);
  if(projectAction){
    if(!validId(projectId))return fail(res,400,'Hãy chọn đồ án trước khi quản lý nhiệm vụ');
    const permitted=await sql`SELECT id FROM sync_projects WHERE id=${projectId} AND room_id=${roomId} LIMIT 1`;
    if(!permitted.length)return fail(res,404,'Đồ án không tồn tại trong nhóm của bạn');
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
      if(actor.role!=='admin')return fail(res,403,'Chỉ trưởng nhóm mới được tạo nhiệm vụ');
      const title=safeStr(body.title,160), description=safeStr(body.description,1000),difficulty=safeStr(body.difficulty,20);
      const points=difficultyPoints[difficulty];
      if(!title||!points) return fail(res,400,'Tên task hoặc độ khó không hợp lệ');
      const assignee=safeStr(body.assigneeId,90) || null;
      if(assignee) { const match=await sql`SELECT id FROM sync_members WHERE room_id=${roomId} AND id=${assignee}`;if(!match.length)return fail(res,400,'Thành viên phụ trách không hợp lệ'); }
      const deadline=body.deadline ? safeStr(body.deadline,10) : null;
      if(deadline && !/^\d{4}-\d{2}-\d{2}$/.test(deadline))return fail(res,400,'Deadline không hợp lệ');
      const id=randomUUID();
      await sql`INSERT INTO sync_tasks(id,room_id,project_id,title,description,assignee_id,difficulty,points,deadline) VALUES (${id},${roomId},${projectId},${title},${description},${assignee},${difficulty},${points},${deadline})`;
      return res.status(201).json({ok:true,id});
    }
    if(action==='task_edit') {
      if(actor.role!=='admin')return fail(res,403,'Chỉ trưởng nhóm mới được chỉnh sửa hoặc phân công nhiệm vụ');
      const id=safeStr(body.id,90), title=safeStr(body.title,160),description=safeStr(body.description,1000),difficulty=safeStr(body.difficulty,20),assignee=safeStr(body.assigneeId,90)||null,deadline=body.deadline?safeStr(body.deadline,10):null;
      if(!validId(id)||!title||!difficultyPoints[difficulty])return fail(res,400,'Dữ liệu task không hợp lệ');
      const current=await sql`SELECT status FROM sync_tasks WHERE id=${id} AND room_id=${roomId} AND project_id=${projectId}`;
      if(!current.length)return fail(res,404,'Không có task');
      if(current[0].status==='done')return fail(res,409,'Task đã xác minh không thể chỉnh sửa');
      if(assignee){const m=await sql`SELECT id FROM sync_members WHERE room_id=${roomId} AND id=${assignee}`;if(!m.length)return fail(res,400,'Người phụ trách không thuộc phòng');}
      if(deadline&&!/^\d{4}-\d{2}-\d{2}$/.test(deadline))return fail(res,400,'Deadline không hợp lệ');
      await sql`UPDATE sync_tasks SET title=${title},description=${description},assignee_id=${assignee},difficulty=${difficulty},points=${difficultyPoints[difficulty]},deadline=${deadline},updated_at=now() WHERE id=${id} AND room_id=${roomId} AND project_id=${projectId} AND status<>'done'`;
      return res.status(200).json({ok:true});
    }
    if(action==='task_status') {
      const id=safeStr(body.id,90), status=safeStr(body.status,20);
      if(!validId(id)||!statuses.includes(status))return fail(res,400,'Trạng thái không hợp lệ');
      if(status==='done') return fail(res,409,'Chỉ hoàn thành qua chức năng Duyệt task');
      const current=await sql`SELECT status,proof_url,assignee_id FROM sync_tasks WHERE room_id=${roomId} AND project_id=${projectId} AND id=${id}`;
      if(!current.length)return fail(res,404,'Không tìm thấy task');
      if(current[0].status==='done')return fail(res,409,'Task đã xác minh không được thay đổi trạng thái');
      if(actor.role!=='admin'&&current[0].assignee_id!==actor.id)
        return fail(res,403,'Chỉ người được phân công hoặc trưởng nhóm mới được cập nhật tiến độ');
      if(status==='review') {
        const proof=safeStr(body.proof||current[0].proof_url,1800);
        if(!proofOK(proof))return fail(res,400,'Cần link HTTPS GitHub, Google Drive hoặc Figma');
        if(!current[0].assignee_id)return fail(res,400,'Cần phân công người phụ trách trước khi chờ duyệt');
        await sql`UPDATE sync_tasks SET status='review',proof_url=${proof},verified_by=NULL,verified_at=NULL,updated_at=now() WHERE room_id=${roomId} AND project_id=${projectId} AND id=${id} AND status<>'done'`;
      }else await sql`UPDATE sync_tasks SET status=${status},verified_by=NULL,verified_at=NULL,updated_at=now() WHERE room_id=${roomId} AND project_id=${projectId} AND id=${id} AND status<>'done'`;
      return res.status(200).json({ok:true});
    }
    if(action==='verify') {
      if(actor.role!=='admin')return fail(res,403,'Chỉ trưởng nhóm được duyệt hoàn thành nhiệm vụ');
      const id=safeStr(body.id,90);
      if(!validId(id))return fail(res,400,'Task ID không hợp lệ');
      const updated=await sql`UPDATE sync_tasks SET status='done',verified_by=${actor.id},verified_at=now(),updated_at=now() WHERE id=${id} AND room_id=${roomId} AND project_id=${projectId} AND status='review' AND assignee_id IS NOT NULL AND proof_url<>'' RETURNING id,assignee_id`;
      if(!updated.length)return fail(res,409,'Chỉ duyệt nhiệm vụ đang Chờ duyệt, đã phân công và có link bằng chứng');
      return res.status(200).json({ok:true,selfApproved:updated[0].assignee_id===actor.id});
    }
    if(action==='roulette') {
      if(actor.role!=='admin')return fail(res,403,'Chỉ trưởng nhóm được quay để phân công nhiệm vụ');
      const candidates=await sql`SELECT id FROM sync_tasks WHERE room_id=${roomId} AND project_id=${projectId} AND assignee_id IS NULL AND status='todo' ORDER BY id`;
      const members=await sql`SELECT id FROM sync_members WHERE room_id=${roomId} ORDER BY id`;
      if(!candidates.length || !members.length)return fail(res,409,'Không có task chưa ai nhận');
      const task=candidates[Math.floor(Math.random()*candidates.length)],chosen=members[Math.floor(Math.random()*members.length)];
      const done=await sql`UPDATE sync_tasks SET assignee_id=${chosen.id},updated_at=now() WHERE id=${task.id} AND room_id=${roomId} AND project_id=${projectId} AND assignee_id IS NULL RETURNING id,title`;
      if(!done.length)return fail(res,409,'Task vừa được thành viên khác nhận, hãy quay lại');
      return res.status(200).json({ok:true,taskId:task.id,memberId:chosen.id,title:done[0].title});
    }
    if(action==='room_edit'){
      if(actor.role!=='admin')return fail(res,403,'Chỉ trưởng nhóm được sửa phòng');
      const group=safeStr(body.group,100),subject=safeStr(body.subject,100);
      if(!group||!subject)return fail(res,400,'Nhập tên nhóm và môn học');
      await sql`UPDATE sync_rooms SET name=${group},subject=${subject},updated_at=now() WHERE id=${roomId}`;
      return res.status(200).json({ok:true});
    }
    if(action==='member_add')return fail(res,403,'Danh sách thành viên được đặt khi tạo phòng');
    if(action==='member_invite')return fail(res,403,'Cả nhóm dùng chung một link phòng');
    return fail(res,404,'Tác vụ không được hỗ trợ');
  }catch(err){return errorResponse(res,err)}
}
