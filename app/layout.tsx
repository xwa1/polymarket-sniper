import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Polymarket Sniper",
  description: "Detecta mercados de alta probabilidad próximos a resolverse en Polymarket.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es">
      <body
        style={{
          margin: 0,
          fontFamily: "system-ui, -apple-system, sans-serif",
          background: "#fff",
          color: "#111",
          minHeight: "100vh",
        }}
      >
        {children}
      </body>
    </html>
  );
}
