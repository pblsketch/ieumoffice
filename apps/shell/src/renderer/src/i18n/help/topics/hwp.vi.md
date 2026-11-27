# Hangul (HWP / HWPX): chỉnh sửa, ngăn làm việc và in ấn

GenOffice mở và chỉnh sửa tài liệu Hangul `.hwp` và `.hwpx` trong một thẻ, với các phím tắt, kiểu, bảng, ghi chú, in ấn và bảng điều khiển AI. Mọi thao tác đều chạy cục bộ trên máy tính của bạn.

## Mở, lưu và in

- Mở tệp `.hwp` và `.hwpx` từ Trang chủ, **Tệp > Mở**, kéo thả vào cửa sổ hoặc Google Drive; chuyển đổi PDF thành các thẻ Hangul mới qua **Tệp > Nhập PDF**.
- Lưu lại đúng định dạng của tệp đã mở (`.hwp` vẫn là `.hwp`, `.hwpx` vẫn là `.hwpx`), giữ bản sao lưu `.bak` trước lần ghi đè đầu tiên, kiểm tra đọc lại HWP và duy trì các bản Tự động lưu cùng khôi phục sau sự cố.
- In (Ctrl+P) hỗ trợ xem trước trực tiếp, xuất PDF và các tùy chọn bố cục in nhiều trang.

## Ngăn làm việc bên trái: Đề cương và Tìm kiếm

- Mở ngăn làm việc bên trái từ nút trên thanh trên cùng, **Xem > Ngăn làm việc** (Đề cương / Tìm kiếm), hoặc nhấn **Ctrl+F** để chuyển thẳng sang thẻ Tìm kiếm. Tìm kiếm truyền thống (**Ctrl+Q,F**) và Tìm & Thay thế (**Ctrl+H**) vẫn khả dụng.
- **Thẻ Đề cương**: liệt kê các tiêu đề đề cương gốc của Hangul và tiêu đề ánh xạ theo kiểu (mặc định `제목 N` / `Heading N`, có thể tùy chỉnh theo từng tài liệu hoặc toàn ứng dụng trong ngăn cài đặt Đề cương). Lọc theo cấp (`1`, `2`, `3`, ... Tất cả), thu gọn nhánh, nhấp để nhảy tới, tăng hoặc giảm cấp tiêu đề (mặc định kèm tiêu đề con, hoặc giữ **Shift** cho một tiêu đề duy nhất) và kéo tiêu đề để sắp xếp lại toàn bộ mục trong một bước hoàn tác.
- **Thẻ Tìm kiếm**: tìm trong văn bản chính, bảng (kể cả bảng lồng nhau), hộp văn bản, chú thích chân trang và chú thích cuối tài liệu (trừ đầu trang và chân trang) với bộ lọc phân biệt hoa thường, khớp toàn từ, biểu thức chính quy, kiểu đoạn và định dạng ký tự. Nhấp vào kết quả để nhảy tới và chọn, hoặc thay thế một, các mục đã chọn hay tất cả kết quả khớp trong một bước hoàn tác (bỏ qua đối tượng nội tuyến và dấu trích dẫn kèm số lượng).
- Ngăn làm việc ghi nhớ trạng thái mở, thẻ đang dùng và chiều rộng, tự thu gọn thành thanh biểu tượng trên cửa sổ hẹp và ẩn đi trong chế độ trình chiếu cũng như xem trước khi in. Mọi tính năng của ngăn làm việc đều hoạt động không cần AI.

## Ghi chú, phím tắt và bảng điều khiển AI

- Mở cột Ghi chú từ thanh trên cùng hoặc **Chèn > Ghi chú** để đọc, thêm, sửa và xóa ghi chú văn bản thuần cạnh tài liệu.
- Hỗ trợ phím tắt chỉnh sửa tài liệu Hangul, dấu đoạn trên thước ngang, Sao chép định dạng (**Alt+C**), chuyển đổi Hanja (**F9** / phím Hanja) và Thông tin tài liệu (**Ctrl+Q,I**).
- Bảng điều khiển AI tùy chọn và [lệnh dòng lệnh](help://cli) (`ieumoffice hwp read`, `ieumoffice hwp apply`) có thể đọc và chỉnh sửa văn bản, kiểu, bảng, phương trình, bố cục trang, đề cương và kết quả tìm kiếm; mỗi lần chỉnh sửa của AI là một bước hoàn tác duy nhất.
