import Link from "next/link";
import styles from "./home.module.css";
import { SiteHeader } from "../components/site-header";
import { PortalCarousel } from "../components/portal-carousel";
import { GameSection } from "../components/game-section";
import { listMostPlayedGames, listRecentGames } from "../lib/game-catalog";
import { portalSlides } from "../lib/portal-slides";
import { homeMetadata } from "./home-metadata";

export const metadata = homeMetadata;

export default function Home() {
  // No durable per-game metrics exist yet (PLATFORM-07B+ must supply them -
  // see docs/ADR-007); an empty list here is what makes listMostPlayedGames
  // fall back to its documented single-game rule instead of a guess.
  const mostPlayed = listMostPlayedGames([]);
  const recent = listRecentGames();

  return (
    <div className={styles.page}>
      <SiteHeader />
      <PortalCarousel slides={portalSlides} />

      <div className={styles.allGames}>
        <Link className={styles.allGamesButton} href="/jogos">Ver todos os jogos</Link>
      </div>

      <GameSection id="mais-jogados" title="Mais jogados" modules={mostPlayed} variant="compact" />
      <GameSection id="jogos-recentes" title="Jogos recentes" modules={recent} variant="compact" />

      <footer className={styles.footer}>
        <span>MultyGames — Jogos para curtir sozinho ou com a turma.</span>
      </footer>
    </div>
  );
}
