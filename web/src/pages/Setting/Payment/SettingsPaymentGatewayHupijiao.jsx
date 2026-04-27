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

import React, { useEffect, useState, useRef } from 'react';
import { Banner, Button, Form, Row, Col, Spin } from '@douyinfe/semi-ui';
import {
  API,
  removeTrailingSlash,
  showError,
  showSuccess,
} from '../../../helpers';
import { useTranslation } from 'react-i18next';
import { BookOpen, Info } from 'lucide-react';

export default function SettingsPaymentGatewayHupijiao(props) {
  const { t } = useTranslation();
  const sectionTitle = props.hideSectionTitle ? undefined : t('虎皮椒设置');
  const [loading, setLoading] = useState(false);
  const [inputs, setInputs] = useState({
    HupijiaoEnabled: false,
    HupijiaoAppId: '',
    HupijiaoAppSecret: '',
    HupijiaoApiUrl: 'https://api.xunhupay.com/payment/do.html',
    HupijiaoNotifyUrl: '',
    HupijiaoReturnUrl: '',
    HupijiaoMinTopUp: 1,
  });
  const [originInputs, setOriginInputs] = useState({});
  const formApiRef = useRef(null);

  useEffect(() => {
    if (props.options && formApiRef.current) {
      const currentInputs = {
        HupijiaoEnabled:
          props.options.HupijiaoEnabled === true ||
          props.options.HupijiaoEnabled === 'true',
        HupijiaoAppId: props.options.HupijiaoAppId || '',
        HupijiaoAppSecret: props.options.HupijiaoAppSecret || '',
        HupijiaoApiUrl:
          props.options.HupijiaoApiUrl ||
          'https://api.xunhupay.com/payment/do.html',
        HupijiaoNotifyUrl: props.options.HupijiaoNotifyUrl || '',
        HupijiaoReturnUrl: props.options.HupijiaoReturnUrl || '',
        HupijiaoMinTopUp: parseInt(props.options.HupijiaoMinTopUp) || 1,
      };
      setInputs(currentInputs);
      setOriginInputs({ ...currentInputs });
      formApiRef.current.setValues(currentInputs);
    }
  }, [props.options]);

  const handleFormChange = (values) => {
    setInputs(values);
  };

  const submitHupijiaoSetting = async () => {
    setLoading(true);
    try {
      const options = [
        {
          key: 'HupijiaoEnabled',
          value: inputs.HupijiaoEnabled ? 'true' : 'false',
        },
        { key: 'HupijiaoAppId', value: inputs.HupijiaoAppId || '' },
        { key: 'HupijiaoAppSecret', value: inputs.HupijiaoAppSecret || '' },
        {
          key: 'HupijiaoApiUrl',
          value:
            inputs.HupijiaoApiUrl ||
            'https://api.xunhupay.com/payment/do.html',
        },
        { key: 'HupijiaoNotifyUrl', value: inputs.HupijiaoNotifyUrl || '' },
        { key: 'HupijiaoReturnUrl', value: inputs.HupijiaoReturnUrl || '' },
        { key: 'HupijiaoMinTopUp', value: String(inputs.HupijiaoMinTopUp || 1) },
      ];

      const requestQueue = options.map((opt) =>
        API.put('/api/option/', {
          key: opt.key,
          value: opt.value,
        }),
      );

      const results = await Promise.all(requestQueue);

      const errorResults = results.filter((res) => !res.data.success);
      if (errorResults.length > 0) {
        errorResults.forEach((res) => {
          showError(res.data.message);
        });
      } else {
        showSuccess(t('更新成功'));
        setOriginInputs({ ...inputs });
        props.refresh?.();
      }
    } catch (error) {
      showError(t('更新失败'));
    }
    setLoading(false);
  };

  return (
    <Spin spinning={loading}>
      <Form
        initValues={inputs}
        onValueChange={handleFormChange}
        getFormApi={(api) => (formApiRef.current = api)}
      >
        <Form.Section text={sectionTitle}>
          <Banner
            type='info'
            icon={<BookOpen size={16} />}
            description={
              <>
                {t('虎皮椒是国内支付网关，支持支付宝/微信支付。')}
                <a
                  href='https://www.xunhupay.com/'
                  target='_blank'
                  rel='noreferrer'
                >
                  {t('官网注册')}
                </a>
                {t('后可在')}
                <a
                  href='https://www.xunhupay.com/user/apply.html'
                  target='_blank'
                  rel='noreferrer'
                >
                  {t('商户后台')}
                </a>
                {t('获取配置信息。')}
              </>
            }
            style={{ marginBottom: 12 }}
          />
          <Banner
            type='info'
            icon={<Info size={16} />}
            description={
              <>
                {t('回调地址')}：
                {props.options.ServerAddress
                  ? removeTrailingSlash(props.options.ServerAddress)
                  : t('网站地址')}
                /api/hupijiao/webhook
                <br />
                {t('返回地址')}：
                {props.options.ServerAddress
                  ? removeTrailingSlash(props.options.ServerAddress)
                  : t('网站地址')}
                /topup
              </>
            }
            style={{ marginBottom: 16 }}
          />

          <Row gutter={{ xs: 8, sm: 16, md: 24, lg: 24, xl: 24, xxl: 24 }}>
            <Col xs={24} sm={24} md={8} lg={8} xl={8}>
              <Form.Switch
                field='HupijiaoEnabled'
                size='default'
                checkedText='｜'
                uncheckedText='〇'
                label={t('启用虎皮椒支付')}
              />
            </Col>
          </Row>

          <Row
            gutter={{ xs: 8, sm: 16, md: 24, lg: 24, xl: 24, xxl: 24 }}
            style={{ marginTop: 16 }}
          >
            <Col xs={24} sm={24} md={8} lg={8} xl={8}>
              <Form.Input
                field='HupijiaoAppId'
                label={t('虎皮椒 APPID')}
                placeholder={t('例如：20190617xxxx')}
                extraText={t('在虎皮椒商户后台获取')}
              />
            </Col>
            <Col xs={24} sm={24} md={8} lg={8} xl={8}>
              <Form.Input
                field='HupijiaoAppSecret'
                label={t('虎皮椒密钥')}
                type='password'
                placeholder={t('例如：71dd8bf6xxxx，留空表示保持当前不变')}
                extraText={t('保存后不会回显，请妥善保管')}
              />
            </Col>
            <Col xs={24} sm={24} md={8} lg={8} xl={8}>
              <Form.Input
                field='HupijiaoApiUrl'
                label={t('API 地址')}
                placeholder='https://api.xunhupay.com/payment/do.html'
                extraText={t('一般无需修改')}
              />
            </Col>
          </Row>

          <Row
            gutter={{ xs: 8, sm: 16, md: 24, lg: 24, xl: 24, xxl: 24 }}
            style={{ marginTop: 16 }}
          >
            <Col xs={24} sm={24} md={12} lg={12} xl={12}>
              <Form.Input
                field='HupijiaoNotifyUrl'
                label={t('回调地址（可选）')}
                placeholder={
                  props.options.ServerAddress
                    ? `${removeTrailingSlash(props.options.ServerAddress)}/api/hupijiao/webhook`
                    : 'https://yourdomain.com/api/hupijiao/webhook'
                }
                extraText={t('留空则自动使用：服务器地址 + /api/hupijiao/webhook')}
              />
            </Col>
            <Col xs={24} sm={24} md={12} lg={12} xl={12}>
              <Form.Input
                field='HupijiaoReturnUrl'
                label={t('返回地址（可选）')}
                placeholder={
                  props.options.ServerAddress
                    ? `${removeTrailingSlash(props.options.ServerAddress)}/topup`
                    : 'https://yourdomain.com/topup'
                }
                extraText={t('留空则自动使用：服务器地址 + /topup')}
              />
            </Col>
          </Row>

          <Row
            gutter={{ xs: 8, sm: 16, md: 24, lg: 24, xl: 24, xxl: 24 }}
            style={{ marginTop: 16 }}
          >
            <Col xs={24} sm={24} md={8} lg={8} xl={8}>
              <Form.InputNumber
                field='HupijiaoMinTopUp'
                label={t('最低充值金额')}
                placeholder={t('例如：1，就是最低充值 1 元')}
                extraText={t('用户单次充值的最低金额限制')}
                min={1}
              />
            </Col>
          </Row>

          <Button onClick={submitHupijiaoSetting} style={{ marginTop: 16 }}>
            {t('更新虎皮椒设置')}
          </Button>
        </Form.Section>
      </Form>
    </Spin>
  );
}
