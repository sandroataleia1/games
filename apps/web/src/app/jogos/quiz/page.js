"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { EVENTS } from "@quizarena/contracts";
import styles from "../../page.module.css";
import { api } from "../../../lib/api";
import { createLobbyClient } from "../../../lib/lobby-client";
import { withNext } from "../../../lib/safe-redirect";

export default function QuizGame() {
  const clientRef = useRef(null);
  const [user, setUser] = useState(null);
  const [checked, setChecked] = useState(false);
  const [status, setStatus] = useState("connecting");
  const [quizzes, setQuizzes] = useState([]);
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
        const response = await client.command(EVENTS.QUIZ_LIST, {});
        if (response?.ok) setQuizzes(response.data.quizzes);
        else setError(response?.error?.message || "Não foi possível carregar os quizzes.");
      },
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
            <div className={styles.brand}><span className={styles.mark} aria-hidden="true">Q</span><span>QuizArena</span></div>
            <Link href="/">Início</Link>
          </header>
          <div className={styles.intro}>
            <span className={styles.eyebrow}>Jogo</span>
            <h1 id="quiz-title">Quiz</h1>
            <p className={styles.description}>
              Perguntas e respostas em tempo real: uma tela principal (TV ou projetor) mostra a pergunta e o placar,
              enquanto cada participante responde pelo próprio celular. Cada rodada tem um tempo limite; quem acerta
              mais rápido pontua mais. O organizador escolhe um quiz publicado, cria uma sala e compartilha o código
              — a partida pode começar com um único participante, e o organizador também pode jogar.
            </p>
            <p className={styles.description}>
              Para ver os quizzes disponíveis, criar ou entrar em uma sala, é necessário ter uma conta na QuizArena.
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
          <div className={styles.brand}><span className={styles.mark} aria-hidden="true">Q</span><span>QuizArena / Quiz</span></div>
          <div role="status" aria-live="polite" className={`${styles.status} ${styles[status]}`}>
            <span className={styles.statusDot} aria-hidden="true" />
            {status === "connected" ? "Servidor conectado" : status === "reconnecting" ? "Reconectando" : "Conectando"}
          </div>
        </header>
        <div className={styles.intro} style={{ padding: "30px 0" }}>
          <h1 id="quiz-title">Quizzes publicados</h1>
          <p className={styles.description}>Escolha um quiz publicado por qualquer organizador para ver as salas abertas ou criar a sua.</p>
        </div>
        {status === "connected" && quizzes.length === 0 && <p className={styles.note}>Nenhum quiz publicado no momento.</p>}
        <div className={styles.quizGrid}>
          {quizzes.map((quiz) => (
            <article className={styles.quizCard} key={quiz.id}>
              <h3>{quiz.title}</h3>
              {quiz.description && <p>{quiz.description}</p>}
              <div className={styles.meta}>
                <span>{quiz.questionCount} pergunta(s)</span>
                {quiz.ownerName && <span>por {quiz.ownerName}</span>}
                {quiz.ownerId === user.id && <span className={styles.badge}>Seu quiz</span>}
              </div>
              <div className={styles.cardActions}>
                <Link className={styles.primary} href={`/jogos/quiz/quizzes/${quiz.id}`}>Ver salas</Link>
              </div>
            </article>
          ))}
        </div>
        <p className={styles.note} role="alert" aria-live="polite">{error}</p>
      </section>
    </main>
  );
}
