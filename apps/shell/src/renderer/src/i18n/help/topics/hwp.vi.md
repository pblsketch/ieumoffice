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

## Mục lục: tạo và cập nhật

- Dùng **Công cụ > Tạo mục lục** (hoặc **Công cụ > Cập nhật mục lục**, hay nhấp chuột phải bên trong mục lục) để chèn **Mục lục** từ các tiêu đề trong Đề cương, cùng với **Danh mục bảng**, **Danh mục hình** và **Danh mục phương trình** lấy từ chú thích đối tượng và đoạn chú thích.
- Chọn bố cục **Tab chấm dẫn** (mặc định) hoặc **Bảng không viền** (2 cột), đặt độ sâu tiêu đề (cấp 1–10, mặc định 3), tùy chỉnh tiêu đề và tùy chọn thêm liên kết có thể nhấp (nhấp hoặc **Ctrl+nhấp** vào một dòng để nhảy thẳng đến tiêu đề tương ứng).
- Số trang phản ánh đúng số trang khi in, bao gồm đánh số lại từ đầu và định dạng số La Mã hoặc định dạng tùy chỉnh.
- Khi cập nhật, các mục và số trang được làm mới tại chỗ; trình soạn thảo sẽ cảnh báo trước khi ghi đè các dòng bạn đã sửa thủ công, đồng thời phát hiện mục lục chưa gắn dấu do chương trình khác tạo và hỏi xác nhận trước khi thay thế.

## Chỉ mục: đánh dấu mục và tạo chỉ mục

- Dùng **Công cụ > Đánh dấu mục chỉ mục** (hoặc nhấp chuột phải trong văn bản chính) để đánh dấu từ đang chọn hoặc tại vị trí con trỏ, thêm mục con tùy chọn hoặc bật đánh dấu tất cả các lần xuất hiện khớp (chỉ trong văn bản chính; báo cáo số lần bị bỏ qua trong bảng, hộp văn bản và chú thích). Bạn cũng có thể xem và xóa các dấu hiện có ngay trong hộp thoại này.
- Dùng **Công cụ > Tạo chỉ mục** để chèn chỉ mục tại vị trí con trỏ và **Công cụ > Cập nhật chỉ mục** để làm mới sau khi chỉnh sửa. Tiêu đề mặc định ("Chỉ mục") có thể thay đổi.
- Các mục được sắp xếp theo thứ tự tiếng Hàn (가나다) → tiếng Anh (ABC) → Khác, hỗ trợ tiêu đề nhóm chữ cái/phụ âm tùy chọn, bố cục 1–3 cột (mặc định 2 cột, chỉ áp dụng riêng cho phần chỉ mục mà không đổi cột của phần tài liệu còn lại) và kiểu **Tab chấm dẫn** hoặc **Bảng không viền**.

## Thông báo mục lỗi thời và Lưu bản nộp

- Khi bạn Lưu thủ công, In, Xuất PDF hoặc Lưu bản nộp, trình soạn thảo sẽ kiểm tra xem mục lục hay chỉ mục có bị lỗi thời không và đề nghị cập nhật tất cả trong một bước hoàn tác duy nhất. Quá trình kiểm tra này không bao giờ chạy khi Tự động lưu và không bao giờ chặn việc lưu.
- Dùng **Tệp > Lưu bản nộp** để lưu một bản sao sạch riêng biệt đã loại bỏ các dấu chỉnh sửa nội bộ (dấu chỉ mục, dấu khối chỉ mục và thiết lập đã lưu), trong khi vẫn giữ nguyên mục lục, neo tiêu đề và liên kết mục lục. Tệp làm việc gốc được giữ nguyên vẹn để bạn có thể tiếp tục cập nhật về sau.
