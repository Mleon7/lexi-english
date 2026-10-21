import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Lexi · Really learn a word in context",
  description: "Start from one meaning of a word, learn it through reading, dictation, and writing, and keep it with smart reviews.",
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
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
