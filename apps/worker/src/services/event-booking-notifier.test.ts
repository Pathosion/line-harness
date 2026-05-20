import { describe, expect, test } from 'vitest';
import { renderEventNotificationText } from './event-booking-notifier.js';

const baseCtx = {
  eventName: 'AAA説明会',
  startsAtJst: '2026-06-01 10:00',
  venueName: '渋谷ベース',
  venueUrl: 'https://maps.example/x',
};

describe('renderEventNotificationText', () => {
  test('受付（承認待ち）', () => {
    const text = renderEventNotificationText('received_pending', baseCtx);
    expect(text).toContain('イベント申込みを受け付けました');
    expect(text).toContain('AAA説明会');
    expect(text).toContain('2026-06-01 10:00');
    expect(text).toContain('運営の承認をお待ちください');
    expect(text).toContain('渋谷ベース');
  });

  test('受付（即時確定）', () => {
    const text = renderEventNotificationText('received_confirmed', baseCtx);
    expect(text).toContain('予約が確定しました');
    expect(text).toContain('変更・キャンセルは予約履歴画面');
  });

  test('後追い承認確定', () => {
    const text = renderEventNotificationText('confirmed', baseCtx);
    expect(text).toContain('予約が確定しました');
  });

  test('拒否は固定文面（reason は含まない）', () => {
    const text = renderEventNotificationText('rejected', baseCtx);
    expect(text).toContain('お受けできませんでした');
    expect(text).not.toContain('reason');
  });

  test('運営キャンセル', () => {
    const text = renderEventNotificationText('cancelled_by_admin', baseCtx);
    expect(text).toContain('運営側でイベント予約をキャンセル');
    expect(text).toContain('LINE にてご連絡');
  });

  test('前日リマインダ', () => {
    const text = renderEventNotificationText('reminder_day_before', baseCtx);
    expect(text).toContain('明日イベントが開催');
  });

  test('開始 N 時間前リマインダ', () => {
    const text = renderEventNotificationText('reminder_hours_before', {
      ...baseCtx,
      hoursBefore: 2,
    });
    expect(text).toContain('まもなくイベント開始');
    expect(text).toContain('あと 2 時間');
  });

  test('venue が無くてもクラッシュしない', () => {
    const text = renderEventNotificationText('received_pending', {
      eventName: 'X',
      startsAtJst: '2026-06-01 10:00',
    });
    expect(text).toContain('X');
    expect(text).not.toContain('会場:');
  });

  test('venue_url のみ無ければ URL 行が出ない', () => {
    const text = renderEventNotificationText('confirmed', {
      eventName: 'X',
      startsAtJst: '2026-06-01 10:00',
      venueName: '渋谷',
    });
    expect(text).toContain('会場: 渋谷');
    expect(text).not.toContain('https://');
  });
});
