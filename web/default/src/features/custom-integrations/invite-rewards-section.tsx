import * as z from 'zod'
import type { Resolver } from 'react-hook-form'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { SettingsSection } from '@/features/system-settings/components/settings-section'
import { useResetForm } from '@/features/system-settings/hooks/use-reset-form'
import { useUpdateOption } from '@/features/system-settings/hooks/use-update-option'
import type { CustomIntegrationSettings } from './types'

const schema = z.object({
  HupijiaoInviteRewardRatio: z.coerce.number().min(0).max(1),
})

type FormValues = z.infer<typeof schema>

type Props = {
  defaultValues: CustomIntegrationSettings
}

function buildDefaults(settings: CustomIntegrationSettings): FormValues {
  return {
    HupijiaoInviteRewardRatio: settings.HupijiaoInviteRewardRatio ?? 0.2,
  }
}

export function InviteRewardsSection({ defaultValues }: Props) {
  const { t } = useTranslation()
  const updateOption = useUpdateOption()
  const formDefaults = buildDefaults(defaultValues)

  const form = useForm<FormValues>({
    resolver: zodResolver(schema) as Resolver<FormValues, unknown, FormValues>,
    mode: 'onChange',
    defaultValues: formDefaults,
  })

  useResetForm(form, formDefaults)

  const handleSubmit = async (values: FormValues) => {
    await updateOption.mutateAsync({
      key: 'HupijiaoInviteRewardRatio',
      value: values.HupijiaoInviteRewardRatio,
    })
    toast.success(t('Saved successfully'))
  }

  return (
    <SettingsSection
      title={t('Invitation Rewards')}
      description={t(
        'Configure rewards for invited users who pay through Hupijiao'
      )}
    >
      <Form {...form}>
        <form onSubmit={form.handleSubmit(handleSubmit)} className='space-y-6'>
          <FormField
            control={form.control}
            name='HupijiaoInviteRewardRatio'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Hupijiao invite reward ratio')}</FormLabel>
                <FormControl>
                  <Input
                    type='number'
                    min={0}
                    max={1}
                    step={0.01}
                    value={field.value ?? ''}
                    onBlur={field.onBlur}
                    name={field.name}
                    ref={field.ref}
                    onChange={(event) =>
                      field.onChange(
                        event.target.value === ''
                          ? ''
                          : event.currentTarget.valueAsNumber
                      )
                    }
                  />
                </FormControl>
                <FormDescription>
                  {t(
                    'Use a decimal ratio. 0.2 means 20% of the paid CNY amount, converted to quota by the Hupijiao price coefficient.'
                  )}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <Button type='submit' disabled={updateOption.isPending}>
            {updateOption.isPending ? t('Saving...') : t('Save Changes')}
          </Button>
        </form>
      </Form>
    </SettingsSection>
  )
}
