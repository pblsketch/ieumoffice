# Bảng điều khiển trợ lý AI

Mọi trình soạn thảo đều có thể gọi bảng AI: chọn một nội dung, đưa ra chỉ dẫn, xem kết quả hiện dần.

## Mở và sử dụng

- Bảng này cần một AI đã kết nối. Khi chưa có, nó hiển thị các thẻ kết nối thay vì báo lỗi; xem [Kết nối gói đăng ký](help://subscription).
- Các lối vào: **nút AI** trên dải ruy-bâng của từng trình soạn thảo, **Hỏi AI** trong menu ngữ cảnh, hoặc Hỏi AI trên thanh đánh dấu.
- Mô tả công việc bằng ngôn ngữ tự nhiên (viết lại đoạn này / biến cột này thành phần trăm / bố cục lại trang này...) rồi nhấn Enter.
- Câu trả lời hiển thị **dạng luồng**; khi AI cần công cụ (đọc tài liệu, sửa tài liệu) thì nó thực thi và tiếp tục cho tới khi xong.
- **Dừng**: có thể ngắt lượt hiện tại bất cứ lúc nào.
- **Hàng đợi**: khi phản hồi đang truyền, Enter đưa tin nhắn của bạn vào hàng đợi thay vì bỏ đi — dải phía trên ô nhập đếm chúng; mở ra để sửa, bỏ, đổi thứ tự, tạm dừng hay dọn sạch. Tin tiếp theo tự gửi khi lượt kết thúc; Esc vẫn dừng lượt như cũ.

## AI nào trả lời

- Danh sách mô hình ở cuối bảng cho thấy AI đang được dùng và cho phép bạn chọn AI khác: các gói đăng ký của bạn trước, rồi đến các nhà cung cấp dùng khóa mà bạn đã thiết lập.
- Khi bạn đã dùng từ 80% một giới hạn của gói đăng ký trở lên, một dòng như "Đã dùng 85% · đặt lại lúc 15:00" sẽ xuất hiện trong bảng.
- Nếu một yêu cầu bị dừng — giới hạn đã dùng hết, hoặc phiên đăng nhập đã hết hạn — bảng sẽ nói rõ lý do và không tự chuyển sang AI khác. Khi gói đăng ký còn lại của bạn đang được kết nối, một nút **Tiếp tục với …** sẽ đề nghị dùng gói đó.

## AI có thể làm gì

- **Docs**: viết lại/mở rộng/dịch/tóm tắt, chèn bảng và hình ảnh, điều chỉnh định dạng; mỗi lượt đều chụp ảnh trước.
- **Sheets**: công thức, điền dữ liệu, biến đổi hàng loạt, định dạng.
- **Slides**: tạo cả bộ trang chiếu, điều chỉnh bố cục, viết lại nội dung.
- **PDF**: hỏi đáp và tóm tắt dựa trên văn bản hoặc trang đã chọn.
- **Markdown / HTML**: viết lại, mở rộng, dịch.
- **Trang chủ ▸ Ask AI** trả lời từ các tệp bạn đánh sao và trích dẫn chúng — bảng cơ sở tri thức có mục riêng trong chương Trang chủ, và bảng AI của Docs cũng mang kỹ năng ấy.

## Đính kèm tài liệu đang mở

Trong bảng AI của trình soạn thảo Docs, Sheets, Slides, Hangul, HTML và sơ đồ tư duy, bạn có thể đính kèm các tài liệu khác đang mở trong GenOffice, hoặc mới mở gần đây, làm tư liệu. Tài liệu đính kèm được xử lý giống hệt một tệp chọn từ máy tính của bạn.

- **`@` trong ô nhập**: gõ `@` ở đầu ô nhập hoặc sau một dấu cách để mở danh sách tài liệu. Nếu cửa sổ đang chia đôi, tài liệu ở ngăn bên cạnh đứng đầu, tiếp theo là các tài liệu đang mở khác và tài liệu gần đây; tài liệu bạn đang làm việc không có trong danh sách. Thu hẹp bằng vài chữ trong tên (có thể có dấu cách) rồi chọn bằng Enter hoặc một cú nhấp: `@tên tài liệu` được chèn vào ô nhập và tài liệu đó được đính kèm. **Tìm thêm…** ở cuối danh sách mở cửa sổ chọn tài liệu được mô tả bên dưới.
- **Đính kèm từ tài liệu GenOffice**: nút này, nằm cạnh nút đính kèm, mở cùng danh sách đó trong một cửa sổ, nơi bạn có thể đánh dấu nhiều tài liệu và đính kèm một lượt.
- Tài liệu có thay đổi chưa lưu và tài liệu mới chưa từng được lưu sẽ hiện mờ và không chọn được. Hãy lưu rồi chọn lại — AI đọc tệp đã lưu.
- Khi hai tài liệu trùng tên nhưng nằm ở các thư mục khác nhau, tên thư mục ngay phía trên sẽ được thêm vào, như `@kế hoạch.docx(Học kỳ 2)`, và tên thư mục đó cũng được gửi cho AI.
- Trình soạn thảo PDF và Markdown chưa có tính năng đính kèm, nên cả hai cách đều không dùng được ở đó.

## Dự án

- Nhấp vào tên dự án ở bên trái, ngay dưới ô nhập, để chọn một dự án (một thư mục trên máy tính của bạn). Khi đó AI trả lời khi đã biết các tệp, chỉ dẫn và ghi nhớ của thư mục ấy, và cuộc trò chuyện được lưu trong thư mục để bạn tiếp tục ở trình soạn thảo khác. Xem [Dự án](help://projects).
- Khi đã chọn dự án, tiêu đề cuộc trò chuyện hiện tại hiện ở phía trên bảng. Nhấp vào đó để xem danh sách cuộc trò chuyện của dự án này và **Cuộc trò chuyện mới**.
- Danh sách `@` trong ô nhập hiện mục "Tệp trong dự án này" sau các tài liệu đang mở.
- Một yêu cầu có chọn dự án cũng gửi chỉ dẫn (kèm `AGENTS.md` và `CLAUDE.md` ở đầu thư mục, có thể tắt trong trang dự án), ghi nhớ và danh sách tên tệp của dự án đó, một đoạn trích ngắn của mỗi tệp AI tìm thấy khi tìm trong thư mục, cùng nội dung của bất kỳ tệp nào AI đọc, tới AI bạn đang dùng.

## Quay lui và an toàn

- Bảng của Docs giữ một **danh sách phiên bản**: mỗi lượt một ảnh chụp, quay lui về bất kỳ ảnh nào, và bản thân thao tác quay lui cũng quay lui được bằng Ctrl+Z. Ảnh chụp vẫn còn sau khi mở lại tài liệu.
- Các chỉnh sửa của AI đi qua đúng quy trình chỉnh sửa như chỉnh sửa thủ công (hoàn tác được, phải qua xác nhận lưu của bạn) — không có gì lách qua bước xác nhận lưu.

## Ẩn thông tin nhạy cảm

- Trong trình soạn thảo Docs, Sheets, Slides, Hangul, Markdown và HTML, bạn có thể giữ một phần tài liệu không cho AI thấy: chọn phần đó, chuột phải ▸ **Ẩn thông tin nhạy cảm** rồi đặt cho nó một nhãn. Dù bạn dùng AI nào, ở chỗ đó AI chỉ đọc được `{{nhãn}}`. (Markdown bật mục này bằng công tắc mắt-gạch-chéo trên ruy-băng; mục của HTML nằm ở bảng mã nguồn; trong Sheets, chuột phải vào tiêu đề cột để ẩn phần cột bên dưới hàng tiêu đề, hoặc vào một vùng ô để chỉ ẩn vùng đó.)
- Tệp vẫn giữ nguyên văn bản thật — lưu, xuất và in không bị ảnh hưởng, và dấu vẫn còn sau khi mở lại. Cũng chính menu đó dùng để thôi ẩn. Trong Hangul, mỗi phần bị ẩn là một ghi chú ghi `[Ẩn thông tin nhạy cảm] nhãn`, nên người nhận tài liệu cũng thấy ghi chú đó, và không thể ẩn chữ đã có ghi chú. Trong Sheets, dấu là một tên được định nghĩa `IeumHide_nhãn`, hiện trong Trình quản lý tên; AI thấy mỗi ô bị ẩn là `{{nhãn-01}}` (cùng giá trị thì cùng số), và ô có công thức dùng ô bị ẩn cũng bị ẩn theo.
- **Tìm thông tin nhạy cảm** trong bảng AI liệt kê những gì trông giống họ tên, số điện thoại, địa chỉ e-mail, số đăng ký cư trú, số tài khoản và số thẻ, địa chỉ và những thứ tương tự. Việc tìm chỉ diễn ra trên máy tính này, bằng các mẫu chữ cố định — không dùng AI để tìm hay để ẩn bất cứ thứ gì — và không có gì bị ẩn cho tới khi bạn chọn **Ẩn**. Mục nào đã **Loại trừ** sẽ không quay lại trong tài liệu đó. Những chỗ không thể đặt dấu (đầu trang, ghi chú người trình bày, tên trang tính, …) cũng được liệt kê để bạn tự sửa.
- Lần đầu bạn gửi trong một thẻ, nếu tài liệu hoặc tệp đính kèm của yêu cầu đó vẫn còn những mục như vậy, bảng sẽ hỏi một lần: **Kiểm tra** không gửi gì và mở danh sách, còn **Vẫn gửi** thì gửi đi.
- HTML ẩn nội dung phần tử, giá trị thuộc tính và hằng chuỗi trong script, và trang hiển thị không bao giờ đổi. Slides còn ẩn cả hình, video và âm thanh trọn vẹn, và slide có nội dung ẩn không bao giờ được gửi dạng ảnh chụp màn hình.
- Phần bị ẩn vẫn bị ẩn khi tệp được đính kèm trong trình soạn thảo khác, được hỏi đến ở Trang chủ, được đọc bằng lệnh `ieumoffice` và các công cụ MCP của lệnh này, hoặc được đọc qua máy chủ MCP của ứng dụng. Khi chuyển sang định dạng không có chỗ cho dấu (ODT, CSV, …), ứng dụng sẽ hỏi trước. Việc ẩn không áp dụng cho các tệp mà chương trình ở chế độ tác tử đọc thẳng từ ổ đĩa, và ảnh trang (`render`) hiện văn bản đúng như trong tệp.

## Quyền riêng tư

- Chỉ dẫn và nội dung tài liệu liên quan được gửi tới **AI mà bạn đang dùng**: tới Anthropic hoặc OpenAI bằng chính tài khoản của bạn khi bạn dùng gói đăng ký, hoặc tới nhà cung cấp mà bạn đã nhập khóa. Khi chưa có AI nào được kết nối thì không có gì được gửi đi.
- Nội dung gửi qua gói đăng ký có được dùng để huấn luyện AI hay không tùy thuộc vào cài đặt tài khoản của bạn tại công ty đó.
- Tập tin cục bộ không được tải lên nơi khác; khóa API được lưu trong tệp cài đặt của ứng dụng trên máy này và chỉ được gửi trong phần đầu yêu cầu.
