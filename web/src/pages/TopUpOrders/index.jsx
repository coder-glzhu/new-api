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

import React from 'react';
import { Typography } from '@douyinfe/semi-ui';
import TopUpOrdersTable from '../../components/table/topup-orders';
import { useTranslation } from 'react-i18next';

const { Title } = Typography;

const TopUpOrders = () => {
  const { t } = useTranslation();

  return (
    <div className='mt-[60px] px-4'>
      <Title heading={3} style={{ marginBottom: 20 }}>
        {t('充值订单')}
      </Title>
      <TopUpOrdersTable />
    </div>
  );
};

export default TopUpOrders;
