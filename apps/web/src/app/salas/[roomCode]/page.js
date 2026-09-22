"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { EVENTS } from "@quizarena/contracts";
import { createLobbyClient } from "../../../lib/lobby-client";
import { api } from "../../../lib/api";
import { withNext } from "../../../lib/safe-redirect";
import styles from "../../page.module.css";

export default function RoomLobby() {
  const { roomCode } = useParams();
  const router = useRouter();
  const clientRef = useRef(null);
  const [user, setUser] = useState(null);
  const [checked, setChecked] = useState(false);
  const [status, setStatus] = useState("connecting");
  const [ready, setReady] = useState(false);
  const [state, setState] = useState(null);
  const [match, setMatch] = useState(null);
  const [selected, setSelected] = useState("");
  const [result, setResult] = useState(null);
  const [ranking, setRanking] = useState([]);
  const [error, setError] = useState("");

  useEffect(() => {
    api("/auth/me").then((data) => setUser(data.user)).catch(() => setUser(null)).finally(() => setChecked(true));
  }, []);

  useEffect(() => {
    if (!checked) return;
    if (!user) router.replace(withNext("/login", `/salas/${roomCode}`));
  }, [checked, user, roomCode, router]);

  useEffect(() => {
    if (!checked || !user || !roomCode) return undefined;
    const client = createLobbyClient({
      onStatusChange: async (next) => {
        setStatus(next);
        setReady(false);
        if (next !== "connected") return;
        const response = await client.command(EVENTS.ROOM_JOIN, { roomCode });
        if (response?.ok) { setState(response.data.state); setMatch(response.data.match); setReady(true); }
        else setError(response?.error?.message || "Não foi possível entrar na sala.");
      },
      onStateChange: (next) => { if (next?.phase) setMatch(next); else setState(next); },
      onQuestionResult: (next) => { setResult(next.ownResult); setRanking(next.ranking); setMatch((current) => current ? { ...current, phase: "QUESTION_RESULT", question: null } : current); },
      onFinished: (next) => { setRanking(next.ranking); setMatch((current) => current ? { ...current, phase: "FINISHED", question: null } : current); },
    });
    clientRef.current = client;
    return client.disconnect;
  }, [checked, user, roomCode]);

  useEffect(() => {
    if (!match?.question?.id) return;
    // A pergunta persistida mudou; a seleção pertence somente à rodada anterior.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelected("");
  }, [match?.question?.id]);

  async function answer(optionId) {
    if (!ready || !match?.question || selected) return;
    setSelected(optionId);
    const response = await clientRef.current.command(EVENTS.GAME_ANSWER, { roomCode, questionId: match.question.id, optionId });
    if (!response?.ok) { setSelected(""); setError(response?.error?.message || "Não foi possível enviar a resposta."); }
  }
  async function leave() {
    await clientRef.current?.command(EVENTS.ROOM_LEAVE, { roomCode });
    router.push("/jogos/quiz");
  }

  if (!checked || !user) return null;
  if (error && !state && !match) {
    return (
      <main className={styles.shell}>
        <section className={styles.board}>
          <p className={styles.note} role="alert">{error}</p>
          <button type="button" className={styles.secondary} onClick={() => router.push("/jogos/quiz")}>Voltar</button>
        </section>
      </main>
    );
  }
  const phase = match?.phase || "LOBBY";
  return (
    <main className={styles.shell}>
      <section className={styles.board} aria-labelledby="room-title">
        <header className={styles.header}>
          <div className={styles.brand}><span className={styles.mark} aria-hidden="true">Q</span><span>QuizArena</span></div>
          <div className={styles.status} role="status" aria-live="polite"><span className={styles.statusDot} />{status === "connected" ? (ready ? "Conectado" : "Sincronizando…") : status === "reconnecting" ? "Reconectando" : "Aguardando conexão"}</div>
        </header>
        {phase === "LOBBY" && (
          <div className={styles.playerForm}>
            <span className={styles.eyebrow}>Você está na sala</span>
            <h1 id="room-title">Aguardando o organizador iniciar</h1>
            <p className={styles.playerName}>{user.name}</p>
            <p>{state?.playerCount ?? 0} jogador(es) na sala · sala {state?.visibility === "PRIVATE" ? "privada" : "pública"}</p>
          </div>
        )}
        {phase === "QUESTION" && match.question && (
          <div className={styles.matchPanel}>
            <span className={styles.eyebrow}>Rodada {match.round} de {match.totalRounds}</span>
            <h1 id="room-title">{match.question.prompt}</h1>
            <div className={styles.answerGrid}>
              {match.question.options.map((option) => (
                <button type="button" className={`${styles.answerTile} ${selected === option.id ? styles.selectedAnswer : ""}`} key={option.id} disabled={!ready || Boolean(selected)} onClick={() => answer(option.id)}>{option.text}</button>
              ))}
            </div>
            <p className={styles.note}>{selected ? "Resposta enviada. Aguarde o resultado." : "Escolha uma alternativa."}</p>
          </div>
        )}
        {phase === "QUESTION_RESULT" && (
          <div className={styles.matchPanel}>
            <span className={styles.eyebrow}>Resultado da rodada</span>
            <h1 id="room-title">{result?.isCorrect ? "Você acertou!" : "Quase lá"}</h1>
            <p className={styles.playerName}>+{result?.pointsAwarded ?? 0} pontos</p>
          </div>
        )}
        {phase === "FINISHED" && (
          <div className={styles.matchPanel}>
            <span className={styles.eyebrow}>Partida encerrada</span>
            <h1 id="room-title">{ranking[0] ? `${ranking[0].displayName} venceu! 🏆` : "Ranking final"}</h1>
            <ol className={styles.ranking}>{ranking.map((player) => <li key={player.id}><span>{player.displayName}</span><strong>{player.score} pts</strong></li>)}</ol>
          </div>
        )}
        <p className={styles.note} role="alert" aria-live="polite">{error}</p>
        {(phase === "LOBBY" || phase === "FINISHED") && <button type="button" className={styles.secondary} onClick={leave}>Sair da sala</button>}
      </section>
    </main>
  );
}
