import Link from "next/link";
import styles from "./game-card.module.css";

const STATUS_LABEL = Object.freeze({ AVAILABLE: "Disponível", COMING_SOON: "Em breve", DISABLED: "Indisponível" });

// One card, three placements ("Mais jogados", "Jogos recentes", the full
// /jogos catalog) - the only thing that differs is `variant`:
// - compact: used in the two homepage discovery sections, which only ever
//   list AVAILABLE games, so no status badge is needed.
// - catalog: used on /jogos, which lists every status, so the badge (and a
//   disabled action for anything not AVAILABLE) matters there.
export function GameCard({ module, variant = "compact" }) {
  const { definition, capabilities } = module;
  const playable = definition.status === "AVAILABLE";
  return (
    <article
      className={styles.card}
      role="listitem"
      data-variant={variant}
      style={{ "--accent-from": definition.visual.accent, "--accent-gradient": definition.visual.gradient }}
    >
      <span className={styles.glyph} aria-hidden="true">{definition.visual.icon}</span>
      {variant === "catalog" && (
        <span className={styles.badge} data-status={definition.status}>{STATUS_LABEL[definition.status]}</span>
      )}
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
          {STATUS_LABEL[definition.status]}
        </button>
      )}
    </article>
  );
}
