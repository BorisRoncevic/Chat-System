import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Chat System",
  description: "Privatni razgovori na jednom mestu",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="sr-Latn">
      <body>{children}</body>
    </html>
  );
}
