# Hangul (HWP / HWPX): chỉnh sửa, ngăn làm việc và in ấn

GenOffice mở và chỉnh sửa tài liệu Hangul `.hwp` và `.hwpx` trong một thẻ, với các phím tắt, kiểu, bảng, ghi chú, in ấn và bảng điều khiển AI. Mọi thao tác đều chạy cục bộ trên máy tính của bạn.

## Mở, lưu và in

- Mở tệp `.hwp` và `.hwpx` từ Trang chủ, **Tệp > Mở**, kéo thả vào cửa sổ hoặc Google Drive; chuyển đổi PDF thành các thẻ Hangul mới qua **Tệp > Nhập PDF**.
- Lưu lại đúng định dạng của tệp đã mở (`.hwp` vẫn là `.hwp`, `.hwpx` vẫn là `.hwpx`), giữ bản sao lưu `.bak` trước lần ghi đè đầu tiên, kiểm tra đọc lại HWP và duy trì các bản Tự động lưu cùng khôi phục sau sự cố.
- In (Ctrl+P) hỗ trợ xem trước trực tiếp, xuất PDF và các tùy chọn bố cục in nhiều trang.

## Ngăn làm việc bên trái: Đề cương, Tìm kiếm và Tài liệu tham khảo

- Mở ngăn làm việc bên trái từ nút trên thanh trên cùng, **Xem > Ngăn làm việc** (Đề cương / Tìm kiếm / Tài liệu tham khảo), hoặc nhấn **Ctrl+F** để chuyển thẳng sang thẻ Tìm kiếm. Tìm kiếm truyền thống (**Ctrl+Q,F**) và Tìm & Thay thế (**Ctrl+H**) vẫn khả dụng.
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

## Tài liệu tham khảo và trích dẫn

- Mở thẻ **Tài liệu tham khảo** trong ngăn làm việc bên trái (hoặc **Công cụ > Tài liệu tham khảo**) để quản lý một thư viện cục bộ duy nhất trên máy tính của bạn với tìm kiếm, thẻ gắn nhãn, thêm/sửa/xóa, nhập và xuất (`BibTeX`, `RIS`, `CSL JSON`), cùng tính năng nhập từng dòng từ danh mục tài liệu tham khảo sẵn có trong tài liệu kèm xem trước xác nhận.
- Hỗ trợ bốn kiểu trích dẫn (**APA 7**, **Chicago**, **MLA 9** và **IEEE**; tài liệu tiếng Hàn theo chuẩn học thuật Hàn Quốc ở cả bốn kiểu). Chèn trích dẫn trong ngoặc, trích dẫn tường thuật hoặc nhiều mục kèm số trang và tạo hay làm mới danh mục tài liệu tham khảo thụt lề treo; đổi kiểu sẽ cập nhật các trích dẫn được đánh dấu cùng danh mục trong một bước hoàn tác duy nhất mà vẫn giữ nguyên các trích dẫn bạn đã sửa thủ công.
- Trình kiểm tra 6 tiêu chí tích hợp (thiếu trong danh mục, mục chưa trích dẫn, thứ tự sắp xếp, thiếu hậu tố a/b, trích dẫn sửa thủ công và mục chưa xác minh) cho phép nhấp để nhảy ngay tới vị trí lỗi, kèm nhắc nhở khi danh mục hoặc số thứ tự IEEE bị lỗi thời trước khi lưu thủ công, in hoặc xuất tệp.
- Tính năng tìm kiếm tài liệu tham khảo bằng AI tùy chọn (khi bật công cụ Internet) luôn đưa các đề xuất vào ở trạng thái **Chưa xác minh** kèm URL nguồn trong ghi chú; bạn không thể trích dẫn hay đưa chúng vào danh mục cho đến khi tự kiểm tra và đánh dấu **Đã xác minh**.

## Macro: ghi phím và kịch bản

- Dùng **Công cụ > Macro** (hoặc nhấn **Alt+Shift+H** để bắt đầu hay dừng ghi phím và **Alt+Shift+X** để dừng) để ghi lại văn bản đã gõ, di chuyển con trỏ, định dạng, kiểu, bảng và các thao tác chỉnh sửa được hỗ trợ trực tiếp thành kịch bản có thể chỉnh sửa. Trong lúc ghi, thanh trên cùng hiển thị trạng thái đang ghi; các thao tác chưa hỗ trợ hoặc lần nhấp chuột sẽ được thông báo ngay và liệt kê trong danh sách bỏ qua khi dừng.
- Mở **Trình quản lý macro** để quản lý các macro lưu cục bộ trên máy, gán tối đa 11 phím tắt (**Alt+1**–**Alt+9**, **Alt+0**, **Alt+-**), chỉnh sửa kịch bản có báo dòng và cột khi lỗi cú pháp, cũng như xuất hoặc nhập tệp văn bản thuần `.ieummacro`. Kịch bản nhập vào được hiển thị đầy đủ và phải xác nhận lưu trước khi chạy; macro nhúng bên trong tệp tài liệu không bao giờ được đọc hay thực thi. Trên macOS, hãy mở và quản lý macro từ trình đơn **Công cụ > Macro** vì các tổ hợp phím Option dùng để nhập ký tự.
- Mọi macro đều chạy đồng bộ trong trình thông dịch giới hạn hỗ trợ API tài liệu của ứng dụng và các đối tượng kịch bản macro tương thích (`HAction`, `HParameterSet`), kèm giới hạn thời gian, số bước, độ sâu lời gọi, bộ nhớ và bảo vệ đối tượng cùng ghi chú. Một lần chạy luôn tương ứng đúng một bước hoàn tác và sẽ khôi phục toàn bộ nếu gặp lỗi, thao tác không hỗ trợ hoặc vượt giới hạn.
- Tùy chọn **Viết bằng AI** (chỉ hiện trong trình chỉnh sửa macro khi bật AI) cho phép mô tả công việc lặp lại để phác thảo kịch bản; chỉ mô tả của bạn và tài liệu tham chiếu API macro được gửi đi, tuyệt đối không gửi nội dung tài liệu. Bản nháp chỉ điền vào ô chỉnh sửa và không bao giờ tự động lưu hay tự động chạy.
