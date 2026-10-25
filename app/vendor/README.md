# Bundled third-party files

Bundled so that checklist photos are read on the device, with no upload, and so it works offline.

- `tesseract/` — [tesseract.js](https://github.com/naptha/tesseract.js) 5.1.1 and tesseract.js-core 5.1.1 (Apache-2.0, see the LICENSE files).
- `tessdata/chi_tra.traineddata.gz` — Traditional Chinese model `4.0.0_best_int` from [tessdata](https://github.com/tesseract-ocr/tessdata) via `@tesseract.js-data/chi_tra` (Apache-2.0).
- `onnx/` — [ONNX Runtime Web](https://github.com/microsoft/onnxruntime) 1.20.1 (MIT) and the U²-Net small model `u2netp.onnx` ([U-2-Net](https://github.com/xuebinqin/U-2-Net), Apache-2.0), used for the sticker "Select subject" cut-out.
