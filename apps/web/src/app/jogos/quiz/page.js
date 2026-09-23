"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { EVENTS } from "@quizarena/contracts";
import styles from "../../page.module.css";
import { api } from "../../../lib/api";
import { createLobbyClient } from "../../../lib/lobby-client";
import { withNext } from "../../../lib/safe-redirect";

const statusLabel = { OPEN: "Aberta", PLAYING: "Jogando" };

export default function QuizGame() {
  const clientRef = useRef(null);
  const [user, setUser] = useState(null);
  const [checked, setChecked] = useState(false);
  const [status, setStatus] = useState("connecting");
  const [rooms, setRooms] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api("/auth/me").then((data) => setUser(data.user)).catch(() => setUser(null)).finally(() => setChecked(true));
  }, []);

  useEffect(() => {
    if (!checked || !user) return undefined;
    const client = createLobbyClient({
      onStatusChange: async (next) => {
        setStatus(next);
        if (next !== "connected") return;
        const response = await client.command(EVENTS.ROOM_LIST, {});
        if (response?.ok) setRooms(response.data.rooms);
        else setError(response?.error?.message || "Não foi possível carregar as salas.");
      },
      onRoomIndex: (payload) => setRooms(payload.rooms),
    });
    clientRef.current = client;
    return client.disconnect;
  }, [checked, user]);

  if (!checked) return null;

  if (!user) {
    return (
      <main className={styles.shell}>
        <section className={styles.board} aria-labelledby="quiz-title">
          <header className={styles.header}>
            <div className={styles.brand}><span className={styles.mark} aria-hidden="true">Q</span><span>MultyGames</span></div>
            <nav className={styles.navLinks}><Link href="/">Início</Link></nav>
          </header>
          <div className={styles.intro}>
            <span className={styles.eyebrow}>Jogo</span>
            <h1 id="quiz-title">Quiz</h1>
            <p className={styles.description}>
              Perguntas e respostas em tempo real: uma tela principal (TV ou projetor) mostra a pergunta e o placar,
              enquanto cada participante responde pelo próprio celular. Cada rodada tem um tempo limite; quem acerta
              mais rápido pontua mais. As salas já existem prontas para jogar — basta entrar em uma, escolher o tema
              e qualquer pessoa na sala pode iniciar a partida.
            </p>
            <p className={styles.description}>
              Para ver as salas disponíveis e entrar em uma, é necessário ter uma conta na MultyGames.
            </p>
          </div>
          <div className={styles.actions} style={{ borderTop: "none", paddingTop: 0 }}>
            <Link className={styles.primary} href={withNext("/login", "/jogos/quiz")}>Entrar</Link>
            <Link className={styles.secondary} href={withNext("/cadastro", "/jogos/quiz")}>Criar conta</Link>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className={styles.shell}>
      <section className={styles.board} aria-labelledby="quiz-title">
        <header className={styles.header}>
          <div className={styles.brand}><span className={styles.mark} aria-hidden="true">Q</span><span>MultyGames / Quiz</span></div>
          <div role="status" aria-live="polite" className={`${styles.status} ${styles[status]}`}>
            <span className={styles.statusDot} aria-hidden="true" />
            {status === "connected" ? "Servidor conectado" : status === "reconnecting" ? "Reconectando" : "Conectando"}
          </div>
        </header>
        <div className={styles.intro} style={{ padding: "30px 0" }}>
          <h1 id="quiz-title">Salas</h1>
          <p className={styles.description}>Entre em uma sala, escolha o tema e comece a jogar. Qualquer pessoa na sala pode iniciar a partida.</p>
        </div>
        {status === "connected" && rooms === null && <p className={styles.note}>Carregando salas…</p>}
        <div className={styles.quizGrid}>
          {rooms?.map((room) => (
            <article className={styles.quizCard} key={room.number}>
              <h3>Sala {room.number}</h3>
              <span className={styles.badge} data-status={room.status === "PLAYING" ? "DISABLED" : undefined}>{statusLabel[room.status] ?? room.status}</span>
              <p>{room.quizTitle ? `Tema: ${room.quizTitle}` : "Sem tema escolhido ainda"}</p>
              <p>{room.playerCount} {room.playerCount === 1 ? "jogador" : "jogadores"}</p>
              <div className={styles.cardActions}>
                <Link className={styles.primary} href={`/salas/${room.number}`}>Entrar</Link>
              </div>
            </article>
          ))}
        </div>
        <p className={styles.note} role="alert" aria-live="polite">{error}</p>
      </section>
    </main>
  );
}
