import Link from "next/link";
import styles from "./catalog.module.css";
import { SiteHeader } from "../../components/site-header";
import { GameSection } from "../../components/game-section";
import { listGames, listPublicCategories, getCategoryBySlug } from "../../lib/game-catalog";
import { buildCatalogView } from "../../lib/catalog-view";
import { catalogMetadata } from "./catalog-metadata";

export const metadata = catalogMetadata;

// Server-rendered: the filter is a plain ?categoria=<slug> query string and
// the controls are ordinary links, so the catalog works without JavaScript
// and every filtered view is a shareable URL.
export default async function GamesCatalog({ searchParams }) {
  const params = (await searchParams) ?? {};
  const categoria = Array.isArray(params.categoria) ? params.categoria[0] : params.categoria;
  const publicCategories = listPublicCategories();
  const view = buildCatalogView({ games: listGames(), publicCategories, getCategoryBySlug, categorySlug: categoria });
  return (
    <div className={styles.page}>
      <SiteHeader />
      <div className={styles.intro}>
        <h1>Todos os jogos</h1>
        <p>Cada modalidade da MultyGames aparece aqui, disponível ou a caminho.</p>
      </div>
      {view.filtersVisible && (
        <nav className={styles.filters} aria-label="Filtrar por categoria">
          <Link href="/jogos" aria-current={view.active ? undefined : "page"}>Todos</Link>
          {publicCategories.map((category) => (
            <Link key={category.key} href={`/jogos?categoria=${category.slug}`} aria-current={view.active?.key === category.key ? "page" : undefined}>{category.name}</Link>
          ))}
        </nav>
      )}
      {view.unknownCategory && <p className={styles.notice} role="status">Categoria não encontrada — mostrando todos os jogos.</p>}
      <GameSection id="todos-os-jogos" title={view.active ? view.active.name : "Catálogo completo"} modules={view.games} variant="catalog" />
    </div>
  );
}
