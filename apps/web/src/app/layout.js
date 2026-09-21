import "./globals.css";

export const metadata = {
  title: "QuizArena",
  description: "Fundacao da plataforma de quiz multiplayer",
};

export default function RootLayout({ children }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
