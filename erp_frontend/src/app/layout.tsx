import type { Metadata } from "next";
import { AuthProvider } from "@/context/AuthContext";
import "./globals.css";

export const metadata: Metadata = {
  title: "ERP Distribusi | Enterprise Resource Planning",
  description:
    "Platform ERP Distribusi terintegrasi untuk Master Data, Procurement P2P, Inventory FEFO, Sales O2C, dan Finance General Ledger dengan kontrol Spatie RBAC.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="id" className="h-full antialiased">
      <body className="min-h-full bg-slate-50 font-sans text-slate-900">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
