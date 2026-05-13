import { createFileRoute } from '@tanstack/react-router'
import { Main } from '@/components/layout'
import { ImagePlayground } from '@/features/image-playground'

export const Route = createFileRoute('/_authenticated/image-playground/')({
  component: ImagePlaygroundPage,
})

function ImagePlaygroundPage() {
  return (
    <Main className='p-0'>
      <ImagePlayground />
    </Main>
  )
}
