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
  const mostPlayed = listMostPlayedGames();
  const recent = listRecentGames();

  return (
    <div className={styles.page}>
      <SiteHeader />
      <h1 className={styles.srOnly}>MultyGames — jogos para curtir sozinho ou com a turma</h1>

      <PortalCarousel slides={portalSlides} />

      <GameSection id="mais-jogados" title="Mais jogados" modules={mostPlayed} variant="compact" />
      <GameSection id="jogos-recentes" title="Jogos recentes" modules={recent} variant="compact" />

      <div className={styles.allGames}>
        <Link className={styles.allGamesButton} href="/jogos">Todos os jogos</Link>
      </div>

      <footer className={styles.footer}>
        <span>MultyGames — Jogos para curtir sozinho ou com a turma.</span>
      </footer>
    </div>
  );
}
