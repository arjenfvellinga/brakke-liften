import "./globals.css";
import { Analytics } from "@vercel/analytics/next";

export const metadata = {
  title: "Brakke Liften",
  description: "NS-stations met brakke liften.",
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
