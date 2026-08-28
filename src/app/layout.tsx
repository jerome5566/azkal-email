import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Azkal Media Email Platform",
  description: "Internal email sending platform",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
