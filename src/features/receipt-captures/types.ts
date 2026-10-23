import type {
  CaptureDraft,
  CaptureField,
  CaptureStatus,
  ReadFields,
  ReceiptStatus,
} from '@/domain/receipt-capture';
import type { ReadyPayload } from '@/domain/unsaved-receipt';

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

/** 保存前のレシート(読み取れた。本人が「保存」を押すまで明細にしない、ADR-133)。 */
export type ReadyReceiptView = ReadyPayload & {
  id: string;
  imageUrl: string | null;
  /** 保存のときに明細へ付ける画像(補正済みがあればそれ)。 */
  imagePath: string;
  capturedOn: string;
  createdAt: string;
};
