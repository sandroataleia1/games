export default function manifest() {
  return {
    name: "QuizArena",
    short_name: "QuizArena",
    description: "A plataforma de jogos em grupo. Quiz ao vivo na TV e no celular.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#100c1c",
    theme_color: "#100c1c",
    lang: "pt-BR",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
