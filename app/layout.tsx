import type { Metadata } from "next";
import { Plus_Jakarta_Sans, JetBrains_Mono } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

const sans = Plus_Jakarta_Sans({
  variable: "--font-sans-src",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const mono = JetBrains_Mono({
  variable: "--font-mono-src",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "NTB - Estoque",
  description: "Sistema de gestão de estoque integrado ao Omie",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR" className={`${sans.variable} ${mono.variable} h-full`} suppressHydrationWarning>
      <head>
        {/* Aplica o tema salvo antes do render, evitando flash claro→escuro */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{if(localStorage.getItem('tema')==='dark')document.documentElement.classList.add('dark')}catch(e){}`,
          }}
        />
      </head>
      <body className="min-h-full antialiased">
        {children}
        <Toaster richColors position="top-right" />
      </body>
    </html>
  );
}
