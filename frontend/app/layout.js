import { Archivo } from "next/font/google";

import "./globals.css";
import { Analytics } from "@vercel/analytics/next";

// The design system is set in Archivo throughout, at 400 for body copy and 800
// for every heading, number and lift name. Self-hosted by next/font so there is
// no request to Google on load.
const archivo = Archivo({
  subsets: ["latin"],
  weight: ["400", "600", "800"],
  variable: "--font-archivo",
  display: "swap",
});

export const metadata = {
  title: "Brakke Liften",
  description: "Een overzicht van treinstations met brakke liften.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="nl" className={archivo.variable}>
      <body>
        {/* First tab stop on every page, so the nav is not something a keyboard
            has to walk through to reach the list. Both pages id their <main>. */}
        <a className="skip-link" href="#main">
          Naar de inhoud
        </a>

        {children}

        {/* Every page ends on the same caveat: the lift statuses here are the
            NS ones, and nothing more. */}
        <footer className="site-foot">
          <p className="site-foot-inner">
            Brakkeliften.nl is afhankelijk van de NS voor de liftgegevens en de
            juistheid ervan.
          </p>
        </footer>
        <Analytics />
      </body>
    </html>
  );
}
