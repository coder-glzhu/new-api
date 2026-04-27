import React, { useEffect, useRef, useState } from 'react';
import { Modal, Typography } from '@douyinfe/semi-ui';
import { showError, showSuccess } from '../../../helpers';

const { Text } = Typography;

const COUNTDOWN_SECONDS = 180;

const AlipayQRModal = ({
  t,
  visible,
  qrcodeUrl,
  orderId,
  amount,
  onCheckPaid,
  onTimeout,
  onClose,
}) => {
  const [remaining, setRemaining] = useState(COUNTDOWN_SECONDS);
  const [checking, setChecking] = useState(false);
  const timerRef = useRef(null);
  const startRef = useRef(null);

  useEffect(() => {
    if (!visible) {
      setRemaining(COUNTDOWN_SECONDS);
      if (timerRef.current) clearInterval(timerRef.current);
      return;
    }
    startRef.current = Date.now();
    setRemaining(COUNTDOWN_SECONDS);
    timerRef.current = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startRef.current) / 1000);
      const left = Math.max(0, COUNTDOWN_SECONDS - elapsed);
      setRemaining(left);
      if (left <= 0) {
        clearInterval(timerRef.current);
      }
    }, 1000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [visible]);

  useEffect(() => {
    if (remaining <= 0 && visible) {
      onTimeout?.();
    }
  }, [remaining, visible]);

  const minutes = Math.floor(remaining / 60);
  const seconds = remaining % 60;
  const timeStr = `${minutes}:${seconds.toString().padStart(2, '0')}`;
  const urgent = remaining <= 30;

  const handleOk = async () => {
    setChecking(true);
    try {
      const paid = await onCheckPaid?.();
      if (paid) return;
      return Promise.reject();
    } finally {
      setChecking(false);
    }
  };

  return (
    <Modal
      title={null}
      visible={visible}
      onCancel={onClose}
      maskClosable={false}
      centered
      footer={null}
      width={400}
      bodyStyle={{ padding: 0 }}
      closeOnEsc={false}
    >
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '32px 24px 24px',
      }}>
        {/* Alipay logo + title */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginBottom: 8,
        }}>
          <svg viewBox="0 0 1024 1024" width="24" height="24">
            <path d="M197.9 786.1c-64.5-60.5-104.9-146.5-104.9-241.5C93 337.4 261.4 169 468.5 169S844 337.4 844 544.6c0 95-40.4 181-104.9 241.5l.1.1C674.7 848.8 576 889 468.5 889s-206.2-40.2-270.5-102.8l-.1-.1z" fill="#1677FF"/>
            <path d="M595.4 583.7c-35.7-13.7-73.9-27.4-89.9-32.8 18.7-42.3 32.1-90.9 37.5-143.1H604V376h-136v-46.4h-49.2V376h-136v31.8h136V444H312.5v31.8h178.8c-5.9 38.7-17.6 74.7-33.5 106-46.5-17.3-97.5-27.2-128.6-27.2-70.7 0-119.3 37.6-119.3 90.3 0 52.7 48.6 90.3 119.3 90.3 55.3 0 116.2-26.4 164.1-75.3 33.8 18.2 93.2 47.3 155 73.2l35-62.5-87.9-86.9zM329.2 700.8c-43.2 0-74-18.3-74-52.5 0-34.2 30.8-52.5 74-52.5 27.2 0 67 8.5 107.2 23.9-38.6 51.2-74.5 81.1-107.2 81.1z" fill="#FFFFFF"/>
          </svg>
          <Text style={{ fontSize: 18, fontWeight: 600 }}>
            {t('支付宝扫码支付')}
          </Text>
        </div>

        {/* Amount */}
        {amount > 0 && (
          <div style={{
            margin: '12px 0 4px',
            display: 'flex',
            alignItems: 'baseline',
            gap: 2,
          }}>
            <span style={{ fontSize: 16, fontWeight: 500, color: '#f5222d' }}>¥</span>
            <span style={{ fontSize: 36, fontWeight: 700, color: '#f5222d', lineHeight: 1 }}>
              {amount.toFixed(Number.isInteger(amount) ? 0 : 2)}
            </span>
          </div>
        )}

        {/* QR code */}
        <div style={{
          margin: '16px 0',
          padding: 12,
          borderRadius: 12,
          border: '1px solid #e8e8e8',
          background: '#fff',
          display: 'inline-flex',
        }}>
          <img
            src={qrcodeUrl}
            alt="QR"
            style={{ width: 200, height: 200, display: 'block' }}
          />
        </div>

        {/* Order ID */}
        {orderId && (
          <Text type="tertiary" size="small" style={{ marginBottom: 4 }}>
            {t('订单号')}：{orderId}
          </Text>
        )}

        {/* Countdown */}
        <div style={{
          margin: '8px 0 20px',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
        }}>
          <div style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: urgent ? '#f5222d' : '#52c41a',
            animation: urgent ? 'pulse 1s infinite' : 'none',
          }} />
          {remaining > 0 ? (
            <Text size="small" style={{ color: urgent ? '#f5222d' : '#8c8c8c' }}>
              {t('请在')} <span style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{timeStr}</span> {t('内完成支付')}
            </Text>
          ) : (
            <Text size="small" type="danger">
              {t('订单已超时')}
            </Text>
          )}
        </div>

        {/* Action button */}
        <button
          onClick={handleOk}
          disabled={checking || remaining <= 0}
          style={{
            width: '100%',
            height: 44,
            borderRadius: 8,
            border: 'none',
            background: remaining <= 0 ? '#d9d9d9' : '#1677FF',
            color: '#fff',
            fontSize: 16,
            fontWeight: 600,
            cursor: remaining <= 0 ? 'not-allowed' : 'pointer',
            opacity: checking ? 0.7 : 1,
            transition: 'all 0.2s',
          }}
        >
          {checking ? t('查询中...') : remaining <= 0 ? t('订单已超时') : t('已完成支付')}
        </button>
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
      `}</style>
    </Modal>
  );
};

export default AlipayQRModal;
