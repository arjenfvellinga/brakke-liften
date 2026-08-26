import "./globals.css";
import { Analytics } from "@vercel/analytics/next";

export const metadata = {
  title: "Brakke Liften",
  description:
    "NS-stations met liften die buiten dienst of van onbekende status zijn.",
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
