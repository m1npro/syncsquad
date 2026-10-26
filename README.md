# SyncSquad — SPA quản lý nhóm học tập

SyncSquad dùng HTML5, Tailwind CSS (CDN), Vanilla JavaScript và Neon PostgreSQL, triển khai qua Vercel.

## Các tính năng
- **Tạo phòng độc lập** cho từng nhóm, từ 3 đến 8 thành viên. Người đầu tiên là trưởng nhóm; khi tạo đặt PIN 4 chữ số.
- **Nhiều đồ án trong cùng một phòng:** host tạo / đổi tên đồ án. Mỗi đồ án có Kanban nhiệm vụ và báo cáo điểm riêng; lịch rảnh, thành viên, và link mời vẫn dùng chung.
- **Một link mời chung** dạng `https://syncsquad-silk.vercel.app/?room=SS-XXXXXXXXXXXX`; không nhúng token phiên đăng nhập.
- Người truy cập link thấy danh sách tên. Tên **chưa tham gia** có thể nhận bằng PIN 4 số; thao tác khóa tên nguyên tử trong Neon để ngăn hai người chọn trùng.
- Tên **đã tham gia** phải nhập đúng PIN để khôi phục phiên trên thiết bị khác. Nhập sai nhiều lần sẽ khóa tạm 15 phút.
- Phiên đăng nhập lưu trong LocalStorage của chính trình duyệt và xác thực qua API. Các bản ghi phòng, lịch, nhiệm vụ dùng chung được lưu trên Neon.
- Ma trận 6 ca × 7 ngày, parser thời khóa biểu, gợi ý giờ vàng và Google Calendar.
- Kanban **Nhiệm Vụ** gồm 4 trạng thái, proof-of-work, đánh giá chéo, vòng quay chia task.
- SOS nhóm, biểu đồ điểm đóng góp, xuất Markdown và in/PDF.
- Trưởng nhóm có quyền chỉnh tên phòng và môn học. Thành viên không thể tự nâng thành trưởng nhóm.

## Cấu hình
1. Tạo Neon PostgreSQL và chạy `db/schema.sql` (an toàn với các bảng đã có).
2. Trong Vercel → Settings → Environment Variables, đặt `DATABASE_URL` ở **Production** (và Preview nếu deploy preview).
3. Repo triển khai từ thư mục gốc, Vercel tự phục vụ `index.html` và API ở `api/room.js`.
4. Kiểm tra `/api/health`: phải trả `{"ok":true,"database":"connected"}`.

## Dùng thử
1. Mở URL chính không có `?room=`, tạo phòng với tên nhóm, môn học, danh sách thành viên và PIN trưởng nhóm.
2. Bấm **Copy link phòng**, gửi một lần vào Zalo/Messenger/Discord.
3. Trưởng nhóm có thể mở tab **Đồ án → Tạo đồ án**, đặt tên, mô tả; cả nhóm chọn đồ án trong menu bên trái.
4. Mỗi thành viên truy cập link, chọn **Tôi là [tên]**, đặt PIN 4 số lần đầu, và sử dụng phòng.
5. Nếu trên trình duyệt khác, chọn lại tên **Đã tham gia** và nhập PIN đã đặt.
6. Muốn quay lại màn hình tạo phòng, chọn **Tạo phòng khác** trên màn hình nhận tên.

## Bảo mật / giới hạn
- PIN 4 số chỉ là cơ chế bảo vệ cơ bản, không tương đương xác minh email hoặc SSO. Người nhận tên trước sẽ khóa tên; trưởng nhóm phải tạo phòng bằng PIN của chính mình và bảo mật mã PIN.
- Thành viên đã quên PIN sẽ cần cơ chế xác minh và khôi phục được bổ sung sau; không có tính năng reset PIN tự động.
- API duyệt task kiểm tra người xác nhận không phải người được giao việc.
- Không công bố hoặc commit `DATABASE_URL`. Chỉ lưu trong biến môi trường server của Vercel.
- Các phòng cũ vẫn tồn tại; không tự động xóa hay di chuyển dữ liệu.

## API
- `GET /api/room?room=...&public=1`: tên phòng và trạng thái đã nhận của các thành viên.
- `POST /api/room` `action=create`: tạo phòng, trả credential trưởng nhóm.
- `POST /api/room` `action=claim`: nhận tên lần đầu (PIN).
- `POST /api/room` `action=pin_login`: đăng nhập lại khi tên đã nhận.
- `POST /api/room` `action=logout`: thu hồi phiên.
- `GET /api/room?room=...` (Bearer token): dữ liệu nội bộ phòng.

## API đồ án
- `GET /api/room?room=...&project=<project_id>` (Bearer): trả danh sách đồ án trong phòng cùng nhiệm vụ của đồ án đang chọn.
- `POST /api/room` `action=project_create` (host): tạo đồ án trong phòng; tên không trùng trong cùng nhóm.
- `POST /api/room` `action=project_edit` (host): cập nhật tên, mô tả.
- Tất cả hành động thao tác nhiệm vụ phải gửi `projectId` hợp lệ, thuộc cùng phòng người dùng.
- Dữ liệu task cũ được giữ trong đồ án mặc định khi chạy `db/schema.sql`.
