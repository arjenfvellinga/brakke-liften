import "./globals.css";
import { Analytics } from "@vercel/analytics/next";

export const metadata = {
  title: "Next.js + FastAPI Services Demo",
  description: "Vercel Services example with Next.js frontend and FastAPI backend.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        {children}
        <Analytics />
      </body>
    </html>
  );
}
