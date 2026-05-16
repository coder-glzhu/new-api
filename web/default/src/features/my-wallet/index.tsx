import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { SectionPageLayout } from '@/components/layout'
import { HupijiaoPaymentDialog } from '@/components/payment/hupijiao-payment-dialog'
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs'
import { BillingHistoryDialog } from '@/features/wallet/components/dialogs/billing-history-dialog'
import { PaymentConfirmDialog } from '@/features/wallet/components/dialogs/payment-confirm-dialog'
import { TransferDialog } from '@/features/wallet/components/dialogs/transfer-dialog'
import { PAYMENT_TYPES } from '@/features/wallet/constants'
import { AffiliateTab } from './components/affiliate-tab'
import { BalanceStatsCard } from './components/balance-stats-card'
import { RechargeTab } from './components/recharge-tab'
import { SubscriptionTab } from './components/subscription-tab'
import { useMyWallet } from './hooks/use-my-wallet'

interface MyWalletProps {
  initialShowHistory?: boolean
}

export function MyWallet({ initialShowHistory }: MyWalletProps) {
  const { t } = useTranslation()
  const wallet = useMyWallet(initialShowHistory)

  const alipayMethod = useMemo(
    () => ({
      type: PAYMENT_TYPES.ALIPAY,
      name: t('Alipay'),
      color: '#1677FF',
    }),
    [t]
  )

  return (
    <>
      <SectionPageLayout>
        <SectionPageLayout.Title>{t('Wallet')}</SectionPageLayout.Title>
        <SectionPageLayout.Description>
          {t('Manage your balance and payment methods')}
        </SectionPageLayout.Description>
        <SectionPageLayout.Content>
          <div className='mx-auto flex w-full max-w-7xl flex-col gap-4 sm:gap-5'>
            <BalanceStatsCard
              user={wallet.user}
              loading={wallet.userLoading}
            />

            <Tabs
              value={wallet.activeTab}
              onValueChange={(value) =>
                wallet.setActiveTab(
                  (value as 'recharge' | 'subscription' | 'affiliate') ||
                    'subscription'
                )
              }
              className='gap-4'
            >
              <div className='overflow-x-auto pb-1'>
                <TabsList className='h-10 min-w-max'>
                  <TabsTrigger value='subscription' className='px-4'>
                    {t('Subscription')}
                  </TabsTrigger>
                  <TabsTrigger value='recharge' className='px-4'>
                    {t('Recharge')}
                  </TabsTrigger>
                  <TabsTrigger value='affiliate' className='px-4'>
                    {t('Referral Program')}
                  </TabsTrigger>
                </TabsList>
              </div>

              <TabsContent value='subscription' className='mt-0'>
                <SubscriptionTab
                  topupInfo={wallet.topupInfo}
                  onPurchaseComplete={wallet.refreshUser}
                />
              </TabsContent>

              <TabsContent value='recharge' className='mt-0'>
                <RechargeTab
                  hupijiaoEnabled={wallet.hupijiaoEnabled}
                  presetAmounts={wallet.presetAmounts}
                  selectedPreset={wallet.selectedPreset}
                  onSelectPreset={wallet.handleSelectPreset}
                  topupAmount={wallet.topupAmount}
                  onTopupAmountChange={wallet.handleTopupAmountChange}
                  paymentAmount={wallet.paymentAmount}
                  calculating={wallet.calculating}
                  minTopup={wallet.minTopup}
                  priceRatio={wallet.priceRatio}
                  paymentLoading={wallet.paymentLoading}
                  onAlipayClick={wallet.handleAlipayClick}
                  redemptionCode={wallet.redemptionCode}
                  onRedemptionCodeChange={wallet.setRedemptionCode}
                  onRedeem={wallet.handleRedeem}
                  redeeming={wallet.redeeming}
                  redemptionEnabled={wallet.redemptionEnabled}
                  loading={wallet.topupLoading}
                  onOpenBilling={() => wallet.setBillingDialogOpen(true)}
                />
              </TabsContent>

              <TabsContent value='affiliate' className='mt-0'>
                <AffiliateTab
                  user={wallet.user}
                  affiliateLink={wallet.affiliateLink}
                  onTransfer={() => wallet.setTransferDialogOpen(true)}
                  complianceConfirmed={wallet.complianceConfirmed}
                  loading={wallet.affiliateLoading}
                />
              </TabsContent>
            </Tabs>
          </div>
        </SectionPageLayout.Content>
      </SectionPageLayout>

      <PaymentConfirmDialog
        open={wallet.confirmDialogOpen}
        onOpenChange={wallet.setConfirmDialogOpen}
        onConfirm={wallet.handlePaymentConfirm}
        topupAmount={wallet.topupAmount}
        paymentAmount={wallet.paymentAmount}
        paymentMethod={alipayMethod}
        calculating={wallet.calculating}
        processing={wallet.paymentProcessing}
        discountRate={wallet.discountRate}
        usdExchangeRate={1}
      />

      <TransferDialog
        open={wallet.transferDialogOpen}
        onOpenChange={wallet.setTransferDialogOpen}
        onConfirm={wallet.handleTransfer}
        availableQuota={wallet.user?.aff_quota ?? 0}
        transferring={wallet.transferring}
      />

      <BillingHistoryDialog
        open={wallet.billingDialogOpen}
        onOpenChange={wallet.setBillingDialogOpen}
      />

      <HupijiaoPaymentDialog
        open={wallet.hupijiaoDialogOpen}
        onOpenChange={wallet.setHupijiaoDialogOpen}
        payment={wallet.hupijiaoPayment}
        amount={wallet.paymentAmount}
        onExpired={() => {
          wallet.setHupijiaoDialogOpen(false)
          wallet.setHupijiaoPayment(null)
        }}
      />
    </>
  )
}
