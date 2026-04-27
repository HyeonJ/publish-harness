import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "{PROJECT_NAME}",
  description: "publish-harness Next.js project",
};

interface RootLayoutProps {
  readonly children: React.ReactNode;
}

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
