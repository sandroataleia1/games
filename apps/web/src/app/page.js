"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { listAvailableGames } from "@quizarena/contracts";
import styles from "./home.module.css";
import { getGameVisual } from "./game-visuals";
import { api } from "../lib/api";

const games = listAvailableGames();

function ClockIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3.5 2" />
    </svg>
  );
}
function BoltIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
      <path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z" />
    </svg>
  );
}
function UsersIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M2.8 19c.7-3 3-4.8 6.2-4.8s5.5 1.8 6.2 4.8" />
      <circle cx="17.5" cy="8.7" r="2.4" />
      <path d="M15.5 14.5c2.6.2 4.4 1.9 5 4.5" />
    </svg>
  );
}
function TrophyIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d="M7 4h10v4a5 5 0 0 1-10 0V4Z" />
      <path d="M7 5H4a3 3 0 0 0 3 5M17 5h3a3 3 0 0 1-3 5" />
      <path d="M12 13v3M9 20h6M9.5 20c0-1.6.7-2.6 2.5-2.6s2.5 1 2.5 2.6" />
    </svg>
  );
}
function StarIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
      <path d="M12 2l2.6 6.6L22 9l-5.2 4.6L18.2 21 12 17.1 5.8 21l1.4-7.4L2 9l7.4-.4L12 2Z" />
    </svg>
  );
}
function PlayIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
      <path d="M7 4.5v15l13-7.5-13-7.5Z" />
    </svg>
  );
}

function QuizIllustration() {
  return (
    <div className={styles.illustration} aria-hidden="true">
      <span className={styles.floatShape} data-shape="dot-a" />
      <span className={styles.floatShape} data-shape="dot-b" />
      <StarIcon className={styles.floatShape} data-shape="star" />
      <div className={styles.demo}>
        <div className={styles.demoTopRow}>
          <span className={styles.demoTimer}><ClockIcon /> 00:12</span>
          <span className={styles.demoScore}>+850 pts</span>
        </div>
        <p className={styles.demoQuestion}>Qual é a capital da França?</p>
        <div className={styles.demoOptions}>
          <span className={styles.demoOption} data-tone="a" data-picked="true">Paris</span>
          <span className={styles.demoOption} data-tone="b">Roma</span>
          <span className={styles.demoOption} data-tone="c">Madri</span>
          <span className={styles.demoOption} data-tone="d">Lisboa</span>
        </div>
        <div className={styles.demoFooter}>
          <div className={styles.demoAvatars}>
            <span className={styles.demoAvatar} data-tone="a">A</span>
            <span className={styles.demoAvatar} data-tone="b">B</span>
            <span className={styles.demoAvatar} data-tone="c">C</span>
          </div>
          <TrophyIcon className={styles.demoTrophy} />
        </div>
      </div>
    </div>
  );
}

function FeaturedGame({ game, user }) {
  const visual = getGameVisual(game.slug);
  return (
    <article className={styles.featured} style={{ "--accent-from": visual.from, "--accent-to": visual.to, "--accent-ink": visual.ink }}>
      <div className={styles.featuredBody}>
        <span className={styles.statusBadge}><span className={styles.statusDot} aria-hidden="true" />Disponível agora</span>
        <h3>{game.name}</h3>
        <p className={styles.featuredTagline}>Responda rápido, marque pontos e vença seus amigos.</p>
        <ul className={styles.facts}>
          <li><UsersIcon /> A partir de 1 jogador</li>
          <li><BoltIcon /> Tempo real</li>
          <li><ClockIcon /> Partidas rápidas</li>
        </ul>
        <div className={styles.featuredActions}>
          <Link className={styles.play} href={game.route}>
            <PlayIcon />
            {user ? "Jogar agora" : "Ver detalhes"}
          </Link>
          {!user && <Link className={styles.playSecondary} href="/cadastro">Criar conta</Link>}
        </div>
      </div>
      <QuizIllustration />
    </article>
  );
}

function CompactGame({ game }) {
  const visual = getGameVisual(game.slug);
  return (
    <article className={styles.compactCard} style={{ "--accent-from": visual.from, "--accent-to": visual.to, "--accent-ink": visual.ink }}>
      <span className={styles.compactGlyph} aria-hidden="true">{game.icon}</span>
      <h3>{game.name}</h3>
      <p>{game.shortDescription}</p>
      <Link className={styles.play} href={game.route}>
        <PlayIcon />
        Jogar
      </Link>
    </article>
  );
}

export default function Home() {
  const [user, setUser] = useState(null);
  const [checked, setChecked] = useState(false);
  useEffect(() => {
    api("/auth/me").then((data) => setUser(data.user)).catch(() => setUser(null)).finally(() => setChecked(true));
  }, []);
  async function logout() {
    await api("/auth/logout", { method: "POST", body: "{}" });
    setUser(null);
  }
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.brand}>
          <span className={styles.brandMark} aria-hidden="true">Q</span>
          <span className={styles.brandName}>QuizArena</span>
        </div>
        <nav className={styles.nav} aria-label="Principal">
          <a href="#catalogo">Jogos</a>
          {!checked ? null : user ? (
            <>
              <span className={styles.accountName}>Olá, {user.name}</span>
              <Link href="/painel">Meu painel</Link>
              <button type="button" onClick={logout}>Sair</button>
            </>
          ) : (
            <>
              <Link href="/login">Entrar</Link>
              <Link className={styles.cta} href="/cadastro">Criar conta</Link>
            </>
          )}
        </nav>
      </header>

      <div className={styles.hero}>
        <h1>Qual jogo vamos jogar hoje?</h1>
        <p>Escolha um jogo, reúna a turma e comece.</p>
      </div>

      <section className={styles.catalog} id="catalogo" aria-labelledby="catalog-heading">
        <h2 className={styles.catalogLabel} id="catalog-heading">Jogos disponíveis</h2>
        {games.length === 1 ? (
          <FeaturedGame game={games[0]} user={user} />
        ) : (
          <div className={styles.grid} role="list">
            {games.map((game) => <CompactGame game={game} key={game.id} />)}
          </div>
        )}
      </section>
    </div>
  );
}
