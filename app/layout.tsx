import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "词境 Lexi · 在语境里，真正学会一个词",
  description: "以词义为起点，在阅读、听写和表达中学习英语，透过智能复习让记忆更长久。",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased">{children}</body>
    </html>
  );
}
