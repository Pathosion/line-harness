import { LineClient } from '@line-crm/line-sdk';

export type EventNotificationKind =
  | 'received_pending'      // 受付（承認制ON、未承認段階）
  | 'received_confirmed'    // 受付＝即時確定
  | 'confirmed'             // 後追い承認で確定
  | 'rejected'              // 拒否
  | 'cancelled_by_admin'    // 運営側でキャンセル
  | 'reminder_day_before'   // 前日 18:00 JST
  | 'reminder_hours_before';// 開始 N 時間前

export interface EventNotificationContext {
  eventName: string;
  startsAtJst: string; // 例: "2026-06-01 10:00"
  venueName?: string | null;
  venueUrl?: string | null;
  hoursBefore?: number;
}

export function renderEventNotificationText(
  kind: EventNotificationKind,
  ctx: EventNotificationContext,
): string {
  const venueLine = ctx.venueName ? `\n会場: ${ctx.venueName}` : '';
  const venueUrlLine = ctx.venueUrl ? `\n${ctx.venueUrl}` : '';
  const detail = `\nイベント: ${ctx.eventName}\n日時: ${ctx.startsAtJst}${venueLine}${venueUrlLine}`;
  switch (kind) {
    case 'received_pending':
      return `イベント申込みを受け付けました。${detail}\n\n運営の承認をお待ちください。`;
    case 'received_confirmed':
      return `イベント予約が確定しました。${detail}\n\n変更・キャンセルは予約履歴画面からお願いします。`;
    case 'confirmed':
      return `イベント予約が確定しました。${detail}\n\n変更・キャンセルは予約履歴画面からお願いします。`;
    case 'rejected':
      return `申し訳ございません、今回のイベント予約はお受けできませんでした。${detail}`;
    case 'cancelled_by_admin':
      return `運営側でイベント予約をキャンセルさせていただきました。${detail}\n\n詳細は LINE にてご連絡ください。`;
    case 'reminder_day_before':
      return `【リマインド】明日イベントが開催されます。${detail}`;
    case 'reminder_hours_before': {
      const hours = ctx.hoursBefore ?? 0;
      return `【リマインド】まもなくイベント開始です（あと ${hours} 時間）。${detail}`;
    }
  }
}

export interface SendEventNotificationParams {
  channelAccessToken: string;
  toLineUserId: string;
  kind: EventNotificationKind;
  ctx: EventNotificationContext;
}

export async function sendEventBookingNotification(
  params: SendEventNotificationParams,
): Promise<void> {
  const text = renderEventNotificationText(params.kind, params.ctx);
  const client = new LineClient(params.channelAccessToken);
  await client.pushMessage(params.toLineUserId, [{ type: 'text', text }]);
}

export type EventBookingNotificationSender = (
  params: SendEventNotificationParams,
) => Promise<void>;
