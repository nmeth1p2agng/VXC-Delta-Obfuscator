
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "VXC Delta Obfuscator",
  description: "Luau obfuscation and Delta compatibility engine."
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
