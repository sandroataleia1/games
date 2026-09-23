import styles from "./catalog.module.css";
import { SiteHeader } from "../../components/site-header";
import { GameSection } from "../../components/game-section";
import { listGames } from "../../lib/game-catalog";
import { catalogMetadata } from "./catalog-metadata";

export const metadata = catalogMetadata;

export default function GamesCatalog() {
  const games = listGames();
  return (
    <div className={styles.page}>
      <SiteHeader />
      <div className={styles.intro}>
        <h1>Todos os jogos</h1>
        <p>Cada modalidade da MultyGames aparece aqui, disponível ou a caminho.</p>
      </div>
      <GameSection id="todos-os-jogos" title="Catálogo completo" modules={games} variant="catalog" />
    </div>
  );
}
