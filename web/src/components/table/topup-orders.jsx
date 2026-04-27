/*
Copyright (C) 2025 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/

import React, { useEffect, useState } from 'react';
import { Table, Tag, Button, Input, Space, Typography, Popconfirm } from '@douyinfe/semi-ui';
import { API, showError, showSuccess, timestamp2string } from '../../helpers';
import { useTranslation } from 'react-i18next';
import AlipayQRModal from '../topup/modals/AlipayQRModal';

const { Text } = Typography;

const TopUpOrdersTable = () => {
  const { t } = useTranslation();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [qrModal, setQrModal] = useState({ visible: false, qrcodeUrl: '', orderId: '', tradeNo: '', amount: 0 });
  const [pagination, setPagination] = useState({
    currentPage: 1,
    pageSize: 10,
    total: 0,
  });
  const [searchKeyword, setSearchKeyword] = useState('');

  const columns = [
    {
      title: t('订单号'),
      dataIndex: 'open_order_id',
      key: 'open_order_id',
      width: 200,
      render: (text, record) => {
        const displayId = text || record.trade_no;
        return (
          <Text copyable={{ content: displayId }} style={{ fontSize: 12 }}>
            {displayId}
          </Text>
        );
      },
    },
    {
      title: t('充值金额'),
      dataIndex: 'amount',
      key: 'amount',
      width: 100,
      render: (amount) => `$${amount}`,
    },
    {
      title: t('实付金额'),
      dataIndex: 'money',
      key: 'money',
      width: 100,
      render: (money) => `¥${money.toFixed(2)}`,
    },
    {
      title: t('支付方式'),
      dataIndex: 'payment_method',
      key: 'payment_method',
      width: 120,
      render: (method) => {
        const methodMap = {
          stripe: 'Stripe',
          creem: 'Creem',
          waffo: 'Waffo',
          waffo_pancake: 'Waffo Pancake',
          hupijiao: '支付宝',
        };
        return methodMap[method] || method;
      },
    },
    {
      title: t('状态'),
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (status) => {
        const statusConfig = {
          pending: { color: 'yellow', text: t('待支付') },
          success: { color: 'green', text: t('已完成') },
          failed: { color: 'red', text: t('失败') },
          expired: { color: 'grey', text: t('已过期') },
        };
        const config = statusConfig[status] || { color: 'grey', text: status };
        return <Tag color={config.color}>{config.text}</Tag>;
      },
    },
    {
      title: t('创建时间'),
      dataIndex: 'create_time',
      key: 'create_time',
      width: 160,
      render: (timestamp) => timestamp2string(timestamp),
    },
    {
      title: t('完成时间'),
      dataIndex: 'complete_time',
      key: 'complete_time',
      width: 160,
      render: (timestamp) => {
        if (!timestamp || timestamp === 0) return '-';
        return timestamp2string(timestamp);
      },
    },
    {
      title: t('操作'),
      key: 'action',
      width: 180,
      render: (_, record) => {
        if (record.status === 'pending') {
          return (
            <Space>
              <Button
                size="small"
                theme="solid"
                type="primary"
                onClick={() => handleRepay(record)}
              >
                {t('去支付')}
              </Button>
              <Popconfirm
                title={t('确认取消')}
                content={t('确定要取消这个订单吗？')}
                onConfirm={() => handleCancel(record.trade_no)}
                position="topRight"
              >
                <Button size="small" type="danger">
                  {t('取消')}
                </Button>
              </Popconfirm>
            </Space>
          );
        }
        return '-';
      },
    },
  ];

  const loadOrders = async (page = 1, keyword = '') => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: page.toString(),
        page_size: pagination.pageSize.toString(),
      });
      if (keyword) {
        params.append('keyword', keyword);
      }

      const res = await API.get(`/api/user/topup/self?${params.toString()}`);
      const { success, message, data } = res.data;
      if (success) {
        setOrders(data.items || []);
        setPagination({
          ...pagination,
          currentPage: page,
          total: data.total || 0,
        });
      } else {
        showError(message || t('加载订单失败'));
      }
    } catch (error) {
      showError(t('加载订单失败'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadOrders(1);
  }, []);

  const handlePageChange = (page) => {
    loadOrders(page, searchKeyword);
  };

  const handleSearch = () => {
    loadOrders(1, searchKeyword);
  };

  const handleReset = () => {
    setSearchKeyword('');
    loadOrders(1, '');
  };

  const handleCancel = async (tradeNo) => {
    try {
      const res = await API.delete(`/api/user/topup/${tradeNo}`);
      const { success, message } = res.data;
      if (success) {
        showSuccess(t('订单已取消'));
        loadOrders(pagination.currentPage, searchKeyword);
      } else {
        showError(message || t('取消订单失败'));
      }
    } catch (error) {
      showError(t('取消订单失败'));
    }
  };

  const handleRepay = async (order) => {
    try {
      const res = await API.post(`/api/user/topup/${order.trade_no}/repay`);
      const { success, message, data } = res.data;
      if (success) {
        // 如果后端发现订单已支付，直接提示成功
        if (data.paid) {
          showSuccess(message || t('支付成功！配额已到账'));
          loadOrders(pagination.currentPage, searchKeyword);
          return;
        }
        if (data.qrcode_url) {
          setQrModal({
            visible: true,
            qrcodeUrl: data.qrcode_url,
            orderId: data.order_id || '',
            tradeNo: data.trade_no,
            amount: order.money || 0,
          });
        } else if (data.pay_url) {
          // 移动端跳转
          window.location.href = data.pay_url;
        }
      } else {
        showError(message || t('创建支付失败'));
      }
    } catch (error) {
      showError(t('创建支付失败'));
    }
  };

  const handleQrCheckPaid = async () => {
    const { tradeNo, orderId } = qrModal;
    try {
      const res = await API.get(`/api/user/topup/${tradeNo}/status?openid=${orderId}`);
      const { success, message, data: statusData } = res.data;
      if (success && statusData?.paid) {
        showSuccess(message || t('支付成功！配额已到账'));
        setQrModal((s) => ({ ...s, visible: false }));
        setTimeout(() => loadOrders(pagination.currentPage, searchKeyword), 1500);
        return true;
      }
      showError(message || t('订单尚未支付，请完成支付后再试'));
      return false;
    } catch {
      showError(t('查询订单失败'));
      return false;
    }
  };

  return (
    <div>
      <Space style={{ marginBottom: 16 }}>
        <Input
          placeholder={t('搜索订单号')}
          value={searchKeyword}
          onChange={setSearchKeyword}
          onEnterPress={handleSearch}
          style={{ width: 300 }}
        />
        <Button onClick={handleSearch} theme="solid" type="primary">
          {t('搜索')}
        </Button>
        <Button onClick={handleReset}>{t('重置')}</Button>
      </Space>

      <Table
        columns={columns}
        dataSource={orders}
        loading={loading}
        pagination={{
          currentPage: pagination.currentPage,
          pageSize: pagination.pageSize,
          total: pagination.total,
          onPageChange: handlePageChange,
        }}
        rowKey="id"
        empty={t('暂无订单记录')}
      />
      <AlipayQRModal
        t={t}
        visible={qrModal.visible}
        qrcodeUrl={qrModal.qrcodeUrl}
        orderId={qrModal.orderId}
        amount={qrModal.amount}
        onCheckPaid={handleQrCheckPaid}
        onTimeout={() => {
          setQrModal((s) => ({ ...s, visible: false }));
          showError(t('订单已超时，请重新发起支付'));
        }}
        onClose={() => setQrModal((s) => ({ ...s, visible: false }))}
      />
    </div>
  );
};

export default TopUpOrdersTable;
