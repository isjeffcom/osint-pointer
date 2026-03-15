import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Providers } from "@/components/providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "OSINT Pointer",
  description: "OSINT multi-agent confidence dashboard"
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN">
      <body style={{ margin: 0, background: "#0b1020", color: "#e5e7eb", fontFamily: "Inter, sans-serif" }}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
