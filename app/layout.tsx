import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Polymarket Sniper",
  description: "Detecta mercados de alta probabilidad próximos a resolverse en Polymarket.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body style={{ margin: 0, background: "#0a0a0f", color: "#e8e8f0", minHeight: "100vh" }}>
        {children}
      </body>
    </html>
  );
}
