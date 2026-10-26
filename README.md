# SyncSquad v2 — Đồng bộ phòng nhóm qua Neon PostgreSQL

Website SPA sử dụng HTML5, Tailwind CDN, Vanilla JS (ES6+), Lucide, Chart.js, Canvas Confetti. Backend gồm đúng một hàm serverless `api/room.js` chạy trên Vercel. Dữ liệu ở Neon thay vì LocalStorage.

## Các chức năng

- Tạo phòng và nhập từ 3–8 thành viên. Thành viên đầu tiên là trưởng nhóm.
- Mỗi thành viên có một link mời `?room=SS-...#join=<token>`; link được lưu trong trình duyệt sau khi mở. Đổi danh tính chỉ áp dụng cho những thành viên đã được cấp link mời trên cùng thiết bị.
- Ma trận 7 ngày × 6 ca; đánh dấu bận bằng chuột/kéo, Regex parser cho `Thứ X`, `Slot Y`, `Ca Z`, `Tiết Z`, heatmap, chốt lịch và Google Calendar.
- Kanban 4 trạng thái; bằng chứng HTTPS Drive/GitHub/Figma và bắt buộc người khác duyệt mới cộng điểm.
- Vòng quay Canvas phân công task chưa nhận, confetti và âm thanh.
- SOS copy tin nhắn nhóm, báo động trên giao diện.
- Chart.js báo cáo đóng góp, đánh giá chéo, huy hiệu MVP và Free-Rider, in/PDF hoặc copy Markdown.
- Polling mỗi 15 giây để thấy dữ liệu được người khác cập nhật, mọi thao tác ghi vào Neon ngay.

## Triển khai Vercel

1. Tạo một repository GitHub trống (có thể chọn Private), upload các file trong thư mục gốc repo này: `index.html`, `app.js`, `style.css`, `package.json`, `vercel.json`, `api/room.js`, `db/schema.sql`, `.gitignore`, `README.md`.
2. Vercel → Project `syncsquad` → Settings → Git → Connect Git Repository, chọn repo vừa tạo. Nếu dự án hiện tại không thể liên kết thì Import Project từ repo và sau khi kiểm tra thành công, chuyển tên miền cũ sang project mới.
3. Trên [Neon Console](https://console.neon.tech), mở đúng database và chạy `db/schema.sql` trong SQL Editor nếu bốn bảng chưa được tạo.
4. Vercel → Project → Settings → Environment Variables → thêm `DATABASE_URL` bằng **connection string từ Neon**. Chọn Production và Preview. Không bỏ connection string vào mã nguồn; không gửi nó qua chat.
5. Deploy / Redeploy sang Production. Test API bằng cách tạo phòng và chia sẻ link mời **của thành viên khác** sang chế độ ẩn danh. Refresh cả hai thiết bị để đối chiếu.

### Kiểm tra

Sau khi có `DATABASE_URL`:
- `POST /api/room` với `{ "action":"create", "group":"...", "subject":"...", "members":["A","B","C"] }` tạo phòng và link.
- `GET /api/room?room=SS-...` cần `Authorization: Bearer <member token>` để xem dữ liệu.
- `POST /api/room` với action `busy_batch`, `task_create`, `task_edit`, `task_status`, `verify`, `roulette`, `member_add`, `member_invite`, `room_edit` yêu cầu cùng header.

## Lưu ý an toàn / giới hạn

- Room ID **không** phải mật khẩu. Chỉ link mời từng thành viên cho phép truy cập. Không đăng link mời lên nơi công khai.
- Token đã tham gia sẽ được lưu ở LocalStorage của trình duyệt, nên người dùng máy tính chung cần xóa dữ liệu site sau khi dùng. Link mời có thể được trưởng nhóm cấp lại để thu hồi link cũ.
- Xác minh task bị từ chối tại API khi người bấm duyệt là chính người được giao task. Trưởng nhóm có quyền cấp lại link của thành viên khác nên vẫn cần sự tin tưởng và quy chế nhóm phù hợp.
- Chưa có đăng nhập bằng tài khoản đại học / email / Google OAuth, phân quyền nâng cao, chống spam/rate limiting, realtime push; v2 sử dụng polling 15 giây và link mời. Muốn đưa vào quy mô lớn cần auth + rate limiting + audit logs.
- Dữ liệu LocalStorage phiên bản cũ **không tự động tải lên Neon**. Mẫu tạo phòng đọc sẵn danh sách thành viên cũ trên cùng trình duyệt; danh sách task và lịch bận cũ cần nhập lại hoặc bổ sung tiện ích nhập dữ liệu riêng.
- Điểm chữ A+/A/B/C/D chỉ là quy tắc đề xuất theo phần trăm đóng góp, giảng viên cần phê duyệt chính sách thực tế.