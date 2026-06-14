import type { Metadata } from "next";
import "./globals.css";
import { DocumentUpdatesProvider } from "@/components/providers/DocumentUpdatesProvider";

export const metadata: Metadata = {
  title: "Construction Drawing Estimation",
  description:
    "Upload construction drawing PDFs and review parsed markdown with time and cost estimations.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <DocumentUpdatesProvider>{children}</DocumentUpdatesProvider>
      </body>
    </html>
  );
}
