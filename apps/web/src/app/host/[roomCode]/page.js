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
  const [state, setState] = useState(null);
  const [match, setMatch] = useState(null);
  const [result, setResult] = useState(null);
  const [ranking, setRanking] = useState([]);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!roomCode) return undefined;
    const client = createLobbyClient({ onStatusChange: async (next) => { setStatus(next); if (next === "connected") { const hostToken = sessionValue(storageKeys.host(roomCode)); if (!hostToken) { setError("A credencial desta sala não está disponível neste navegador."); return; } const response = await client.command(EVENTS.HOST_RESUME, { roomCode, hostToken }); if (response?.ok) { setState(response.data.state); setMatch(response.data.match); } else setError(response?.error?.message || "Não foi possível reassumir a sala."); } }, onStateChange: (next) => { if (next?.phase) setMatch(next); else setState(next); }, onQuestionResult: (next) => { setResult(next); setRanking(next.ranking); setMatch((current) => current ? { ...current, phase: "QUESTION_RESULT", question: null } : current); }, onFinished: (next) => { setRanking(next.ranking); setMatch((current) => current ? { ...current, phase: "FINISHED", question: null } : current); } });
    clientRef.current = client;
    return client.disconnect;
  }, [roomCode]);
  async function start() { const response = await clientRef.current.command(EVENTS.GAME_START, { roomCode }); if (!response?.ok) setError(response?.error?.message || "Não foi possível iniciar a partida."); }
  async function next() { const response = await clientRef.current.command(EVENTS.GAME_NEXT, { roomCode }); if (!response?.ok) setError(response?.error?.message || "Não foi possível avançar a rodada."); }
  const phase = match?.phase || "LOBBY";
  return <main className={styles.shell}><section className={styles.board} aria-labelledby="host-title"><header className={styles.header}><div className={styles.brand}><span className={styles.mark}>Q</span><span>QuizArena / Organizador</span></div><div className={styles.status} role="status" aria-live="polite"><span className={styles.statusDot} />{status === "connected" ? "Conectado" : status === "reconnecting" ? "Reconectando" : "Aguardando conexão"}</div></header><div className={styles.lobbyHero}><span className={styles.eyebrow}>Código da sala</span><h1 id="host-title" className={styles.roomCode}>{roomCode}</h1><p>{state?.quiz?.title || "Carregando quiz..."}</p></div>{phase === "LOBBY" && <><div className={styles.playerHeader}><h2>Jogadores</h2><strong>{state?.playerCount ?? 0} / {state?.maxPlayers ?? 20}</strong></div><ul className={styles.players}>{state?.players?.map((player) => <li key={player.id}><span className={styles.playerDot} data-status={player.connectionStatus} />{player.displayName}<small>{player.connectionStatus === "CONNECTED" ? "conectado" : "desconectado"}</small></li>)}</ul><button type="button" className={styles.primary} disabled={!state?.playerCount} onClick={start}>Iniciar partida</button></>}{phase === "QUESTION" && match?.question && <div className={styles.matchPanel}><span className={styles.eyebrow}>Rodada {match.round} de {match.totalRounds}</span><h2>{match.question.prompt}</h2><div className={styles.answerGrid}>{match.question.options.map((option) => <div className={styles.answerTile} key={option.id}>{option.text}</div>)}</div><p className={styles.note}>{match.answeredCount} resposta(s) recebida(s). O servidor controla o tempo.</p></div>}{phase === "QUESTION_RESULT" && <div className={styles.matchPanel}><span className={styles.eyebrow}>Resultado da rodada {match?.round}</span><h2>Resposta revelada</h2><p className={styles.note}>Alternativa correta: {result?.correctOptionId || "disponível aos jogadores"}</p><button type="button" className={styles.primary} onClick={next}>Avançar</button></div>}{phase === "FINISHED" && <div className={styles.matchPanel}><span className={styles.eyebrow}>Partida encerrada</span><h2>Ranking final</h2><ol className={styles.ranking}>{ranking.map((player) => <li key={player.id}><span>{player.displayName}</span><strong>{player.score} pts</strong></li>)}</ol></div>}<p className={styles.note} role="alert" aria-live="polite">{error}</p><button type="button" className={styles.secondary} onClick={() => router.push("/")}>Voltar ao início</button></section></main>;
}
