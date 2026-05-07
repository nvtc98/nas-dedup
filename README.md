# NAS Dedup

Duplicate file checker for Synology NAS.

## Requirements

- Synology DSM 7.x
- Node.js v20 (install from Package Center)

## Install

Upload các file sau vào `/volume1/homes/<username>/nas-dedup/` qua File Station (không cần upload `node_modules`):

```
scan.js
server.js
scanner.worker.js
package.json
package-lock.json
public/
```

Sau đó cài dependencies qua DSM Task Scheduler (xem bên dưới) hoặc SSH:

```bash
cd /volume1/homes/<username>/nas-dedup
npm install
```

## Cách 1 — Standalone scan (không cần SSH, dùng Task Scheduler)

Chạy scan và xuất báo cáo HTML ra file. Phù hợp khi không có SSH.

**Chạy thủ công qua Task Scheduler:**

DSM → Control Panel → Task Scheduler → Create → Scheduled Task → User-defined script

```bash
node /volume1/homes/<username>/nas-dedup/scan.js
```

Kết quả lưu tại: `/volume1/homes/<username>/nas-dedup-report.html`

Mở file trong File Station để xem danh sách duplicate. Xóa thủ công qua File Station.

**Tùy chỉnh thư mục scan và output:**

```bash
node /volume1/homes/<username>/nas-dedup/scan.js /volume1/homes/<username>/Photos /volume1/homes/<username>/report.html
```

## Cách 2 — Web UI (cần SSH hoặc cùng mạng LAN)

Chạy server và truy cập qua browser để xem kết quả interactive và xóa file trực tiếp.

**Yêu cầu thêm:** Recycle Bin bật trên shared folder (DSM → Control Panel → Shared Folder → Edit → Enable Recycle Bin)

```bash
node /volume1/homes/<username>/nas-dedup/server.js
```

Mở `http://<nas-ip>:8080` trong browser.

Chạy nền sau khi đóng SSH:

```bash
nohup node /volume1/homes/<username>/nas-dedup/server.js > /volume1/homes/<username>/nas-dedup/app.log 2>&1 &
```

Dừng server: `ps aux | grep server.js` rồi `kill <PID>`

## Notes

- File được move vào `#recycle` (Synology Recycle Bin), không xóa vĩnh viễn.
- Mặc định scan thư mục `Photos` trong home directory.
- Bỏ qua thư mục `#recycle` khi scan.

