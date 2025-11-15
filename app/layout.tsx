import type { Metadata } from 'next'
import './globals.css'
import Header from '@/components/Header'
import Footer from '@/components/Footer'
import Providers from '@/components/Providers'

export const metadata: Metadata = {
  title: '日本車比較サイト - あなたにピッタリの車を見つけよう',
  description: '日本国内で販売されている自動車を、ボディタイプ、価格、機能などの様々な観点から比較検討できるWebサイト',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="ja">
      <body className="font-sans">
        <Providers>
          <Header />
          <main className="min-h-screen">
            {children}
          </main>
          <Footer />
        </Providers>
      </body>
    </html>
  )
}
