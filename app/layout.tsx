import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Demo Video Recorder",
  description: "Record 20 demo video clips for automateLinux",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className="bg-gray-950 text-gray-100">{children}</body>
    </html>
  );
}
