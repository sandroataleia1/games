import Link from "next/link";
import styles from "./game-card.module.css";
import { resolveCardState, resolveCategoryTags } from "../lib/game-card-state";

// One card, three placements ("Mais jogados", "Jogos recentes", the full
// /jogos catalog) - the only thing that differs is `variant`. Whether the
// action is a real link or a disabled button, and whether the status badge
// shows, is decided once by resolveCardState() (apps/web/src/lib/game-card
// -state.js) from `definition.status` - never re-derived here, and never
// differently per variant, so no placement can accidentally offer a start
// action for a game that isn't AVAILABLE.
export function GameCard({ module, variant = "compact", getCategoryByKey = () => null }) {
  const { definition, capabilities } = module;
  const { playable, showBadge, statusLabel } = resolveCardState(definition, variant);
  const categoryTags = resolveCategoryTags(definition, variant, getCategoryByKey);
  const isQuiz = definition.key === "quiz";
  return (
    <article
      className={styles.card}
      role="listitem"
      data-variant={variant}
      data-game={definition.key}
      style={{ "--accent-from": definition.visual.accent, "--accent-gradient": definition.visual.gradient, "--game-background": definition.visual.background ?? definition.visual.gradient }}
    >
      {showBadge && <span className={styles.badge} data-status={definition.status}>{statusLabel}</span>}
      {categoryTags.length > 0 && (
        <ul className={styles.categoryTags} aria-label="Categorias">
          {categoryTags.map((tag) => <li key={tag.key}>{tag.name}</li>)}
        </ul>
      )}
      <h3>{definition.name}</h3>
      <p>{definition.shortDescription}</p>
      <ul className={styles.meta}>
        <li>{capabilities.minPlayers}–{capabilities.maxPlayers} jogadores</li>
        {capabilities.supportsSolo && <li>Modo solo</li>}
      </ul>
      {isQuiz && <div className={styles.liveCount} aria-label="Jogadores no momento">0 jogando agora</div>}
      {playable ? (
        <Link className={styles.cardLink} href={definition.route} aria-label={`Abrir detalhes de ${definition.name}`} />
      ) : (
        <button type="button" className={styles.action} data-disabled="true" disabled>{statusLabel}</button>
      )}
    </article>
  );
}
