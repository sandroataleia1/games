"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { EVENTS } from "@quizarena/contracts";
import { createLobbyClient } from "../../../lib/lobby-client";
import { api } from "../../../lib/api";
import { withNext } from "../../../lib/safe-redirect";
import styles from "../../page.module.css";

export default function RoomLobby() {
  const params = useParams();
  const roomNumber = Number(params.roomNumber);
  const router = useRouter();
  const clientRef = useRef(null);
  const [user, setUser] = useState(null);
  const [checked, setChecked] = useState(false);
  const [status, setStatus] = useState("connecting");
  const [ready, setReady] = useState(false);
  const [room, setRoom] = useState(null);
  const [match, setMatch] = useState(null);
  const [quizzes, setQuizzes] = useState([]);
  const [selected, setSelected] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [result, setResult] = useState(null);
  const [ranking, setRanking] = useState([]);
  const [error, setError] = useState("");

  useEffect(() => {
    api("/auth/me").then((data) => setUser(data.user)).catch(() => setUser(null)).finally(() => setChecked(true));
  }, []);

  useEffect(() => {
    if (!checked) return;
    if (!user) router.replace(withNext("/login", `/salas/${roomNumber}`));
  }, [checked, user, roomNumber, router]);

  useEffect(() => {
    if (!checked || !user || !Number.isInteger(roomNumber)) return undefined;
    const client = createLobbyClient({
      onStatusChange: async (next) => {
        setStatus(next);
        setReady(false);
        if (next !== "connected") return;
        const [entered, quizList] = await Promise.all([
          client.command(EVENTS.ROOM_ENTER, { roomNumber }),
          client.command(EVENTS.QUIZ_LIST, {}),
        ]);
        if (entered?.ok) { setRoom(entered.data.room); setMatch(entered.data.match); setReady(true); }
        else setError(entered?.error?.message || "Não foi possível entrar na sala.");
        if (quizList?.ok) setQuizzes(quizList.data.quizzes);
      },
      onStateChange: (next) => { if (next?.phase) setMatch(next); else setRoom(next); },
      onQuestionResult: (next) => { setResult(next.ownResult); setRanking(next.ranking); setMatch((current) => current ? { ...current, phase: "QUESTION_RESULT", question: null } : current); },
      onFinished: (next) => { setRanking(next.ranking); setMatch((current) => current ? { ...current, phase: "FINISHED", question: null } : current); },
    });
    clientRef.current = client;
    return client.disconnect;
  }, [checked, user, roomNumber]);

  useEffect(() => {
    if (!match?.question?.id) return;
    // A pergunta persistida mudou; a seleção pertence somente à rodada anterior.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelected("");
    setConfirmed(false);
  }, [match?.question?.id]);

  async function selectTheme(quizId) {
    const response = await clientRef.current.command(EVENTS.THEME_SELECT, { roomNumber, quizId });
    if (!response?.ok) setError(response?.error?.message || "Não foi possível escolher o tema.");
  }
  async function startMatch() {
    if (!ready) return;
    const response = await clientRef.current.command(EVENTS.MATCH_START, { roomNumber });
    if (response?.ok) setMatch(response.data.match);
    else setError(response?.error?.message || "Não foi possível iniciar a partida.");
  }
  function selectOption(optionId) {
    if (!ready || !match?.question || confirmed) return;
    setSelected(optionId);
  }
  async function confirmAnswer() {
    if (!ready || !match?.question || !selected || confirmed) return;
    setConfirmed(true);
    const response = await clientRef.current.command(EVENTS.GAME_ANSWER, { roomNumber, questionId: match.question.id, optionId: selected });
    if (!response?.ok) { setConfirmed(false); setError(response?.error?.message || "Não foi possível enviar a resposta."); }
  }
  async function next() {
    if (!ready) return;
    const response = await clientRef.current.command(EVENTS.GAME_NEXT, { roomNumber });
    if (!response?.ok) setError(response?.error?.message || "Não foi possível avançar a rodada.");
  }
  async function leave() {
    await clientRef.current?.command(EVENTS.ROOM_LEAVE, { roomNumber });
    router.push("/jogos/quiz");
  }
  function backToLobby() {
    setMatch(null);
    setResult(null);
    setRanking([]);
    setSelected("");
    setConfirmed(false);
  }

  if (!checked || !user) return null;
  if (error && !room) {
    return (
      <main className={styles.shell}>
        <section className={styles.board}>
          <p className={styles.note} role="alert">{error}</p>
          <button type="button" className={styles.secondary} onClick={() => router.push("/jogos/quiz")}>Voltar</button>
        </section>
      </main>
    );
  }

  const phase = match?.phase;
  return (
    <main className={styles.shell}>
      <section className={styles.board} aria-labelledby="room-title">
        <header className={styles.header}>
          <div className={styles.brand}><span className={styles.mark} aria-hidden="true">M</span><span>MultyGames / Sala {roomNumber}</span></div>
          <div className={styles.status} role="status" aria-live="polite"><span className={styles.statusDot} />{status === "connected" ? (ready ? "Conectado" : "Sincronizando…") : status === "reconnecting" ? "Reconectando" : "Aguardando conexão"}</div>
        </header>

        {!phase && (
          <>
            <div className={styles.lobbyHero} style={{ padding: "40px 0" }}>
              <span className={styles.eyebrow}>Sala</span>
              <h1 id="room-title" className={styles.roomCode} style={{ fontSize: "clamp(40px,8vw,72px)" }}>{roomNumber}</h1>
            </div>
            <div className={styles.create}>
              <label htmlFor="theme">Tema da sala</label>
              <select id="theme" value={room?.quizId ?? ""} onChange={(event) => selectTheme(event.target.value)} disabled={!ready}>
                <option value="" disabled>Escolha um tema</option>
                {quizzes.map((quiz) => <option key={quiz.id} value={quiz.id}>{quiz.title} ({quiz.questionCount})</option>)}
              </select>
            </div>
            <div className={styles.playerHeader}>
              <h2>Jogadores na sala</h2>
              <strong>{room?.playerCount ?? 0}</strong>
            </div>
            <ul className={styles.players}>
              {room?.players?.map((player) => <li key={player.accountId}><span className={styles.playerDot} data-status="CONNECTED" />{player.displayName}</li>)}
            </ul>
            <p className={styles.note}>{!room?.quizId ? "Escolha um tema para poder iniciar." : !room?.playerCount ? "Aguardando jogadores." : ""}</p>
            <button type="button" className={styles.primary} disabled={!ready || !room?.quizId || !room?.playerCount} onClick={startMatch}>Iniciar partida</button>
          </>
        )}

        {phase === "QUESTION" && match.question && (
          <div className={styles.matchPanel}>
            <span className={styles.eyebrow}>Rodada {match.round} de {match.totalRounds}</span>
            <h1 id="room-title">{match.question.prompt}</h1>
            <div className={styles.answerGrid}>
              {match.question.options.map((option) => (
                <button type="button" className={`${styles.answerTile} ${selected === option.id ? styles.selectedAnswer : ""}`} key={option.id} disabled={!ready || confirmed} onClick={() => selectOption(option.id)}>{option.text}</button>
              ))}
            </div>
            {selected && !confirmed && <button type="button" className={styles.primary} disabled={!ready} onClick={confirmAnswer}>Confirmar resposta</button>}
            <p className={styles.note}>{confirmed ? "Resposta enviada. Aguarde o resultado." : selected ? "Toque em confirmar para enviar sua resposta." : "Escolha uma alternativa."}</p>
          </div>
        )}

        {phase === "QUESTION_RESULT" && (
          <div className={styles.matchPanel}>
            <span className={styles.eyebrow}>Resultado da rodada</span>
            <h1 id="room-title">{result?.isCorrect ? "Você acertou!" : "Quase lá"}</h1>
            <p className={styles.playerName}>+{result?.pointsAwarded ?? 0} pontos</p>
            <button type="button" className={styles.primary} disabled={!ready} onClick={next}>Avançar</button>
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
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {phase === "FINISHED" && <button type="button" className={styles.secondary} onClick={backToLobby}>Voltar à sala</button>}
          <button type="button" className={styles.secondary} onClick={leave}>Sair da sala</button>
        </div>
      </section>
    </main>
  );
}
