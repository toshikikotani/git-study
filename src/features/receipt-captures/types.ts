import type {
  CaptureDraft,
  CaptureField,
  CaptureStatus,
  ReadFields,
  ReceiptStatus,
} from '@/domain/receipt-capture';

/** 画面に渡す「入力待ち」のレシート(画像は署名付きURL)。 */
export type CaptureView = {
  id: string;
  status: CaptureStatus;
  receiptStatus: ReceiptStatus;
  /** 表示する画像(補正済みがあればそれ、なければ元の画像)。 */
  imageUrl: string | null;
  hasEditedImage: boolean;
  readFields: ReadFields;
  unreadFields: CaptureField[];
  draft: CaptureDraft | null;
  capturedOn: string;
  ocrWarnings: string[];
};
