"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { listAvailableGames } from "@quizarena/contracts";
import styles from "./page.module.css";
import { api } from "../lib/api";

const games = listAvailableGames();

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
    <main className={styles.shell}>
      <section className={styles.board} aria-labelledby="title">
        <header className={styles.header}>
          <div className={styles.brand}>
            <span className={styles.mark} aria-hidden="true">Q</span>
            <span>QuizArena</span>
          </div>
          <nav className={styles.navLinks} aria-label="Conta">
            {!checked ? null : user ? (
              <>
                <span>Olá, {user.name}</span>
                <Link href="/painel">Meu painel</Link>
                <button type="button" onClick={logout}>Sair</button>
              </>
            ) : (
              <>
                <Link href="/login">Entrar</Link>
                <Link href="/cadastro">Cadastrar</Link>
              </>
            )}
          </nav>
        </header>
        <div className={styles.intro}>
          <span className={styles.eyebrow}>A plataforma de jogos em grupo</span>
          <h1 id="title">Escolha um jogo.<br /><em>Jogue com a sua turma.</em></h1>
          <p className={styles.description}>Uma plataforma com vários jogos multiplayer. O primeiro deles: Quiz, perguntas e respostas em tempo real na TV e no celular.</p>
        </div>
        <div className={styles.games} role="list">
          {games.map((game) => (
            <article className={styles.gameCard} key={game.id} role="listitem">
              <span className={styles.mark} aria-hidden="true">{game.icon}</span>
              <span className={styles.badge} data-status={game.status}>Disponível</span>
              <h3>{game.name}</h3>
              <p>{game.shortDescription}</p>
              <Link className={styles.primary} href={game.route}>
                {user ? "Jogar" : "Ver detalhes"}
              </Link>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
