import Link from "next/link";
import styles from "./game-card.module.css";
import { resolveCardState } from "../lib/game-card-state";

// One card, three placements ("Mais jogados", "Jogos recentes", the full
// /jogos catalog) - the only thing that differs is `variant`. Whether the
// action is a real link or a disabled button, and whether the status badge
// shows, is decided once by resolveCardState() (apps/web/src/lib/game-card
// -state.js) from `definition.status` - never re-derived here, and never
// differently per variant, so no placement can accidentally offer a start
// action for a game that isn't AVAILABLE.
export function GameCard({ module, variant = "compact" }) {
  const { definition, capabilities } = module;
  const { playable, showBadge, statusLabel } = resolveCardState(definition, variant);
  return (
    <article
      className={styles.card}
      role="listitem"
      data-variant={variant}
      style={{ "--accent-from": definition.visual.accent, "--accent-gradient": definition.visual.gradient }}
    >
      <span className={styles.glyph} aria-hidden="true">{definition.visual.icon}</span>
      {showBadge && <span className={styles.badge} data-status={definition.status}>{statusLabel}</span>}
      <h3>{definition.name}</h3>
      <p>{definition.shortDescription}</p>
      <ul className={styles.meta}>
        <li>{capabilities.minPlayers}–{capabilities.maxPlayers} jogadores</li>
        {capabilities.supportsSolo && <li>Modo solo</li>}
      </ul>
      {playable ? (
        <Link className={styles.action} href={definition.route}>Jogar</Link>
      ) : (
        <button type="button" className={styles.action} data-disabled="true" disabled>
          {statusLabel}
        </button>
      )}
    </article>
  );
}
