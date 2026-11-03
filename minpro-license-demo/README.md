# MinPro License Demo
Đây là mã nguồn của MinPro License API đang triển khai thử nghiệm trên Vercel.

**Branch tạm thời:** `minpro-license-demo`; **không thay đổi nhánh main** của SyncSquad.

- API: POST /api/license/check
- Health: GET /api/health
- DB: Neon PostgreSQL project `minpro-license-demo`.
- API deploy: https://minpro-license-demo-paeo7osxh-manhmovippro118-2842.vercel.app

**Cấu hình bắt buộc trên Vercel (không commit giá trị):**
DATABASE_URL, LICENSE_PEPPER, LICENSE_SIGNING_KEY_PEM, LICENSE_ISSUER, LICENSE_AUDIENCE.

Để chạy cục bộ, chép riêng thư mục này thành project Next.js, chạy `npm install`, sau đó cấu hình .env riêng.

**Chưa tích hợp với AutoNTH.exe.** Không có trang quản trị hoặc cấp key công khai.