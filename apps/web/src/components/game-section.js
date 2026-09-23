import { GameCard } from "./game-card";
import styles from "./game-section.module.css";

export function GameSection({ id, title, modules, variant = "compact" }) {
  if (!modules.length) return null;
  const headingId = `${id}-heading`;
  return (
    <section className={styles.section} id={id} aria-labelledby={headingId}>
      <h2 className={styles.heading} id={headingId}>{title}</h2>
      <div className={styles.grid} role="list">
        {modules.map((module) => <GameCard module={module} variant={variant} key={module.definition.key} />)}
      </div>
    </section>
  );
}
