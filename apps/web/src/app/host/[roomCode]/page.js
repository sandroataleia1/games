"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { EVENTS } from "@quizarena/contracts";
import { createLobbyClient, sessionValue, storageKeys } from "../../../lib/lobby-client";
import styles from "../../page.module.css";

export default function HostMatch() {
  const { roomCode } = useParams();
  const router = useRouter();
  const clientRef = useRef(null);
  const [status, setStatus] = useState("connecting");
  const [ready, setReady] = useState(false);
  const [state, setState] = useState(null);
  const [match, setMatch] = useState(null);
  const [playing, setPlaying] = useState(false);
  const [selected, setSelected] = useState("");
  const [result, setResult] = useState(null);
  const [ranking, setRanking] = useState([]);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!roomCode) return undefined;
    const client = createLobbyClient({
      onStatusChange: async (next) => {
        setStatus(next);
        setReady(false);
        if (next !== "connected") return;
        const hostToken = sessionValue(storageKeys.host(roomCode)) || undefined;
        const response = await client.command(EVENTS.HOST_RESUME, { roomCode, ...(hostToken ? { hostToken } : {}) });
        if (response?.ok) { setState(response.data.state); setMatch(response.data.match); setPlaying(Boolean(response.data.playing)); setReady(true); }
        else setError(response?.error?.message || "Não foi possível reassumir a sala. Você precisa estar logado com a conta que criou esta sala.");
      },
      onStateChange: (next) => { if (next?.phase) setMatch(next); else setState(next); },
      onQuestionResult: (next) => { setResult(next); setRanking(next.ranking); setMatch((current) => current ? { ...current, phase: "QUESTION_RESULT", question: null } : current); },
      onFinished: (next) => { setRanking(next.ranking); setMatch((current) => current ? { ...current, phase: "FINISHED", question: null } : current); },
    });
    clientRef.current = client;
    return client.disconnect;
  }, [roomCode]);
  useEffect(() => {
    if (!match?.question?.id) return;
    // A pergunta persistida mudou; a seleção pertence somente à rodada anterior.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelected("");
  }, [match?.question?.id]);
  async function start() { if (!ready) return; const response = await clientRef.current.command(EVENTS.GAME_START, { roomCode }); if (!response?.ok) setError(response?.error?.message || "Não foi possível iniciar a partida."); }
  async function next() { if (!ready) return; const response = await clientRef.current.command(EVENTS.GAME_NEXT, { roomCode }); if (!response?.ok) setError(response?.error?.message || "Não foi possível avançar a rodada."); }
  async function answer(optionId) { if (!ready || !match?.question || selected) return; setSelected(optionId); const response = await clientRef.current.command(EVENTS.GAME_ANSWER, { roomCode, questionId: match.question.id, optionId }); if (!response?.ok) { setSelected(""); setError(response?.error?.message || "Não foi possível enviar a resposta."); } }
  const phase = match?.phase || "LOBBY";
  return <main className={styles.shell}><section className={styles.board} aria-labelledby="host-title"><header className={styles.header}><div className={styles.brand}><span className={styles.mark}>Q</span><span>QuizArena / Organizador{playing ? " e jogador" : ""}</span></div><div className={styles.status} role="status" aria-live="polite"><span className={styles.statusDot} />{status === "connected" ? (ready ? "Conectado" : "Sincronizando…") : status === "reconnecting" ? "Reconectando" : "Aguardando conexão"}</div></header><div className={styles.lobbyHero}><span className={styles.eyebrow}>Código da sala</span><h1 id="host-title" className={styles.roomCode}>{roomCode}</h1><p>{state?.quiz?.title || "Carregando quiz..."} · sala {state?.visibility === "PRIVATE" ? "privada" : "pública"}</p></div>{phase === "LOBBY" && <><div className={styles.playerHeader}><h2>Jogadores</h2><strong>{state?.playerCount ?? 0} / {state?.maxPlayers ?? 20}</strong></div><ul className={styles.players}>{state?.players?.map((player) => <li key={player.id}><span className={styles.playerDot} data-status={player.connectionStatus} />{player.displayName}<small>{player.connectionStatus === "CONNECTED" ? "conectado" : "desconectado"}</small></li>)}</ul><p className={styles.note}>{!ready ? "Sincronizando com o servidor…" : !state?.playerCount ? (playing ? "Aguardando o servidor registrar sua participação…" : "Escolha \"Organizar e jogar\" ao criar a sala, ou aguarde outra pessoa entrar, para poder iniciar.") : ""}</p><button type="button" className={styles.primary} disabled={!ready || !state?.playerCount} onClick={start}>Iniciar partida</button></>}{phase === "QUESTION" && match?.question && <div className={styles.matchPanel}><span className={styles.eyebrow}>Rodada {match.round} de {match.totalRounds}</span><h2>{match.question.prompt}</h2>{playing ? <div className={styles.answerGrid}>{match.question.options.map((option) => <button type="button" className={`${styles.answerTile} ${selected === option.id ? styles.selectedAnswer : ""}`} key={option.id} disabled={!ready || Boolean(selected)} onClick={() => answer(option.id)}>{option.text}</button>)}</div> : <div className={styles.answerGrid}>{match.question.options.map((option) => <div className={styles.answerTile} key={option.id}>{option.text}</div>)}</div>}<p className={styles.note}>{playing && selected ? "Resposta enviada. " : ""}{match.answeredCount} resposta(s) recebida(s). O servidor controla o tempo.</p></div>}{phase === "QUESTION_RESULT" && <div className={styles.matchPanel}><span className={styles.eyebrow}>Resultado da rodada {match?.round}</span><h2>{playing ? (result?.ownResult?.isCorrect ? "Você acertou!" : "Resposta revelada") : "Resposta revelada"}</h2>{playing && result?.ownResult && <p className={styles.playerName}>+{result.ownResult.pointsAwarded} pontos</p>}<p className={styles.note}>Alternativa correta: {result?.correctOptionId || "disponível aos jogadores"}</p><button type="button" className={styles.primary} disabled={!ready} onClick={next}>Avançar</button></div>}{phase === "FINISHED" && <div className={styles.matchPanel}><span className={styles.eyebrow}>Partida encerrada</span><h2>Ranking final</h2><ol className={styles.ranking}>{ranking.map((player) => <li key={player.id}><span>{player.displayName}</span><strong>{player.score} pts</strong></li>)}</ol></div>}<p className={styles.note} role="alert" aria-live="polite">{error}</p><button type="button" className={styles.secondary} onClick={() => router.push("/jogos/quiz")}>← Quizzes</button></section></main>;
}
