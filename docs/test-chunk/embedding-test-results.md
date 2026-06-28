# Embedding test results — bge-m3

Model: `bge-m3:latest` (Ollama, `/api/embed`) — output dim: 1024
Source: `node src/rag/test-embed-chunk.js` over `docs/test-chunk/`

| # | File | Chunk | Chars | Preview (first 80 chars) | Dim | Embedding preview (first 5) |
|---|------|-------|-------|---------------------------|-----|------------------------------|
| 1 | daily-planner.log | 0 | 1133 | Daily plan for 2026-06-22 (09:00-17:00): 09:00-10:30 Fix login bug 10:30-10:45... | 1024 | -0.0577, 0.0088, -0.0057, -0.0102, -0.0437 |
| 2 | daily-planner.log | 1 | 528 | 09:14-10:00 Sync WIRE adapter with new MCP schema 10:00-10:10 break 10:10-11:4... | 1024 | -0.0796, 0.0055, -0.0053, -0.0006, -0.0495 |
| 3 | small-paragraph.txt | 0 | 279 | Welcome to Innovatech. We are dedicated to providing cutting-edge technology s... | 1024 | -0.0677, -0.0042, -0.0123, -0.0112, -0.0348 |
| 4 | test.docx | 0 | 977 | Mẫu số 15. Đơn đăng ký đất đai, tài sản gắn liền với đất CỘNG HÒA XÃ HỘI CHỦ NG... | 1024 | 0.0034, 0.0133, -0.0436, 0.0016, -0.0359 |
| 5 | test.docx | 1 | 1135 | (Trường hợp đăng ký nhiều thửa đất nông nghiệp mà không đề nghị cấp Giấy chứng... | 1024 | -0.0425, 0.0100, -0.0384, -0.0012, -0.0245 |
| 6 | test.docx | 2 | 1190 | (Chỉ kê khai nếu có nhu cầu đăng ký hoặc chứng nhận quyền sở hữu tài sản; Trườ... | 1024 | -0.0186, 0.0074, -0.0287, 0.0170, 0.0019 |
| 7 | test.docx | 3 | 1104 | a) Đề nghị đăng ký đất đai, tài sản gắn liền với đất □ b) Đề nghị cấp Giấy chứn... | 1024 | -0.0090, 0.0258, -0.0464, -0.0062, -0.0364 |
| 8 | test.docx | 4 | 1163 | (2) Cá nhân: Ghi họ và tên bằng chữ in hoa, năm sinh theo giấy tờ nhân thân. N... | 1024 | -0.0256, 0.0153, -0.0186, -0.0113, -0.0189 |
| 9 | test.docx | 5 | 1111 | (7) Ghi mục đích đang sử dụng chính của thửa đất. Từ thời điểm ghi ngày ... th... | 1024 | -0.0334, 0.0293, -0.0214, 0.0198, -0.0160 |
| 10 | test.docx | 6 | 900 | (13) Đối với nhà ở, công trình một tầng thì không ghi nội dung này. Đối với nh... | 1024 | -0.0067, 0.0071, -0.0287, 0.0035, -0.0071 |
| 11 | test.docx | 7 | 1098 | (19) Đối với tổ chức thì phải nộp kèm theo Báo cáo kết quả rà soát hiện trạng ... | 1024 | -0.0224, 0.0059, -0.0506, -0.0026, -0.0354 |
| 12 | test.docx | 8 | 1166 | DANH SÁCH CÁC THỬA ĐẤTCỦA MỘT HỘ GIA ĐÌNH, CÁ NHÂN, CỘNG ĐỒNG DÂN CƯ, NGƯỜI GỐ... | 1024 | -0.0273, 0.0054, -0.0714, -0.0022, -0.0177 |
| 13 | test.docx | 9 | 1192 | CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAMĐộc lập - Tự do - Hạnh phúc--------------- S... | 1024 | -0.0028, 0.0099, -0.0744, -0.0039, -0.0400 |
| 14 | test.docx | 10 | 1184 | e) Diện tích đất đã bố trí làm nhà ở: ........................................ | 1024 | -0.0146, 0.0265, -0.0308, -0.0058, -0.0130 |
| 15 | test.docx | 11 | 1072 | 4. Diện tích được Nhà nước cho thuê đất trả tiền thuê đất hàng năm: ........... | 1024 | -0.0183, 0.0331, -0.0424, -0.0100, -0.0286 |
| 16 | test.docx | 12 | 1200 | 3. .............................................................................. | 1024 | -0.0300, 0.0601, -0.0312, -0.0054, -0.0234 |
| 17 | test.docx | 13 | 1164 | (2) Ghi tên và địa chỉ trụ sở chính của tổ chức theo quyết định thành lập hoặc... | 1024 | -0.0228, 0.0047, -0.0339, -0.0060, -0.0310 |
| 18 | test.docx | 14 | 1152 | 3. Tổng diện tích đất đang quản lý: …………………………………………………. m2; trong đó: a) Diệ... | 1024 | -0.0365, 0.0496, -0.0382, -0.0282, -0.0198 |
| 19 | test.docx | 15 | 925 | - Trích lục bản đồ địa chính hoặc mảnh trích đo bản đồ địa chính thửa đất (nếu... | 1024 | -0.0299, 0.0249, -0.0418, -0.0078, -0.0147 |

## Summary

| File | Content chars | Chunks |
|---|---|---|
| daily-planner.log | 1664 | 2 |
| small-paragraph.txt | 279 | 1 |
| test.docx | 17967 (post-`extractText`) | 16 |

All 19 chunks embedded successfully with `bge-m3`, each returning a 1024-dim vector, no errors.
