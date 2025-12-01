import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import HomeButton from '@/components/HomeButton';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: '模型玩具采购协同系统',
  description: '多门店模型玩具采购协同与售后系统',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body className={inter.className}>
        {children}
        <HomeButton />
      </body>
    </html>
  );
}

