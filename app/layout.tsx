import type { Metadata, Viewport } from "next";
import { Toaster } from "@/components/ui/sonner";
import { MotionProvider } from "@/components/MotionProvider";
import "./globals.css";

export const metadata: Metadata = {
  title: "Norte Estoque",
  description: "Sistema de gestão de estoque integrado ao Omie",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "Norte Estoque" },
};

export const viewport: Viewport = {
  themeColor: "#168e9a",
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR" className="h-full" suppressHydrationWarning>
      <head>
        {/* Aplica o tema salvo antes do render, evitando flash claro→escuro */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem('tema');var d=t?t==='dark':window.matchMedia('(prefers-color-scheme: dark)').matches;if(d)document.documentElement.classList.add('dark')}catch(e){}`,
          }}
        />
      </head>
      <body className="min-h-full antialiased">
        <MotionProvider>{children}</MotionProvider>
        <Toaster position="top-center" />
      </body>
    </html>
  );
}
