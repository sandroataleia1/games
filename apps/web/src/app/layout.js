import { Baloo_2, Manrope } from "next/font/google";
import "./globals.css";
import { RegisterServiceWorker } from "./register-sw";

const display = Baloo_2({ subsets: ["latin"], weight: ["600", "700", "800"], variable: "--font-display" });
const body = Manrope({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-body" });

export const metadata = {
  title: "QuizArena",
  description: "A plataforma de jogos em grupo. Quiz ao vivo na TV e no celular.",
  applicationName: "QuizArena",
  appleWebApp: {
    capable: true,
    title: "QuizArena",
    statusBarStyle: "black-translucent",
  },
  other: {
    "mobile-web-app-capable": "yes",
    "apple-mobile-web-app-capable": "yes",
  },
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: "/icons/apple-touch-icon.png",
  },
};

export const viewport = {
  themeColor: "#100c1c",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }) {
  return (
    <html lang="pt-BR" className={`${display.variable} ${body.variable}`}>
      <body>
        {children}
        <RegisterServiceWorker />
      </body>
    </html>
  );
}
