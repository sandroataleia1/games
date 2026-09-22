"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { EVENTS } from "@quizarena/contracts";
import { createLobbyClient, saveSession, sessionValue, storageKeys } from "../../../lib/lobby-client";
import styles from "../../page.module.css";

export default function PlayerMatch() {
  const { roomCode } = useParams();
  const router = useRouter();
  const clientRef = useRef(null);
  const [status, setStatus] = useState("connecting");
  const [state, setState] = useState(null);
  const [match, setMatch] = useState(null);
  const [name, setName] = useState("");
  const [joined, setJoined] = useState(false);
  const [selected, setSelected] = useState("");
  const [result, setResult] = useState(null);
  const [ranking, setRanking] = useState([]);
  const [error, setError] = useState("");
  const [, setRemaining] = useState(0);
  useEffect(() => {
    if (!roomCode) return undefined;
    const client = createLobbyClient({ onStatusChange: async (next) => { setStatus(next); if (next === "connected") { const saved = sessionValue(storageKeys.player(roomCode)); if (!saved) return; try { const credentials = JSON.parse(saved); const response = await client.command(EVENTS.ROOM_RESUME, { roomCode, ...credentials }); if (response?.ok) { setJoined(true); setState(response.data.state); setMatch(response.data.match); } else setError(response?.error?.message || "Não foi possível reassumir sua entrada."); } catch { setError("A credencial da sala está inválida."); } } }, onStateChange: (next) => { if (next?.phase) setMatch(next); else setState(next); }, onQuestionResult: (next) => { setResult(next.ownResult); setRanking(next.ranking); setMatch((current) => current ? { ...current, phase: "QUESTION_RESULT", question: null } : current); }, onFinished: (next) => { setRanking(next.ranking); setMatch((current) => current ? { ...current, phase: "FINISHED", question: null } : current); } });
    clientRef.current = client;
    return client.disconnect;
  }, [roomCode]);
  async function join(event) { event.preventDefault(); setError(""); const response = await clientRef.current?.command(EVENTS.ROOM_JOIN, { roomCode, displayName: name }); if (!response?.ok) { setError(response?.error?.message || "Não foi possível entrar na sala."); return; } saveSession(storageKeys.player(roomCode), JSON.stringify({ participantId: response.data.participantId, reconnectToken: response.data.reconnectToken })); setJoined(true); setState(response.data.state); setMatch(response.data.match); }
  async function answer(optionId) { if (!match?.question || selected) return; setSelected(optionId); const response = await clientRef.current.command(EVENTS.GAME_ANSWER, { roomCode, questionId: match.question.id, optionId }); if (!response?.ok) { setSelected(""); setError(response?.error?.message || "Não foi possível enviar a resposta."); } }
  async function leave() { await clientRef.current?.command(EVENTS.ROOM_LEAVE, { roomCode }); sessionStorage.removeItem(storageKeys.player(roomCode)); router.push("/"); }
  useEffect(() => { if (!match?.question?.endsAt) return undefined; const update = () => setRemaining(Math.max(0, Math.ceil((new Date(match.question.endsAt).getTime() - Date.now()) / 1000))); update(); const timer = setInterval(update, 250); return () => clearInterval(timer); }, [match?.question?.endsAt]);
  useEffect(() => {
    if (!match?.question?.id) return;
    // A pergunta persistida mudou; a seleção pertence somente à rodada anterior.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelected("");
  }, [match?.question?.id]);
  const phase = match?.phase || "LOBBY";
  return <main className={styles.shell}><section className={styles.board} aria-labelledby="player-title"><header className={styles.header}><div className={styles.brand}><span className={styles.mark}>Q</span><span>QuizArena</span></div><div className={styles.status} role="status" aria-live="polite"><span className={styles.statusDot} />{status === "connected" ? "Conectado" : status === "reconnecting" ? "Reconectando" : "Aguardando conexão"}</div></header>{!joined ? <div className={styles.playerForm}><span className={styles.eyebrow}>Você foi convidado</span><h1 id="player-title">Entre na sala <em>{roomCode}</em></h1><p>Digite seu nome para aparecer no lobby.</p><form onSubmit={join}><label htmlFor="display-name">Seu nome</label><input id="display-name" value={name} onChange={(event) => setName(event.target.value)} minLength={2} maxLength={24} autoComplete="name" autoFocus /><button type="submit" className={styles.primary} disabled={status !== "connected" || name.trim().length < 2}>Entrar no lobby</button></form></div> : phase === "LOBBY" ? <div className={styles.playerForm}><span className={styles.eyebrow}>Você está na sala</span><h1 id="player-title">Aguardando o organizador iniciar</h1><p className={styles.playerName}>{name}</p><p>{state?.playerCount ?? 0} jogador(es) na sala</p></div> : phase === "QUESTION" && match.question ? <div className={styles.matchPanel}><span className={styles.eyebrow}>Rodada {match.round} de {match.totalRounds}</span><h1 id="player-title">{match.question.prompt}</h1><div className={styles.answerGrid}>{match.question.options.map((option) => <button type="button" className={`${styles.answerTile} ${selected === option.id ? styles.selectedAnswer : ""}`} key={option.id} disabled={Boolean(selected)} onClick={() => answer(option.id)}>{option.text}</button>)}</div><p className={styles.note}>{selected ? "Resposta enviada. Aguarde o resultado." : "Escolha uma alternativa."}</p></div> : phase === "QUESTION_RESULT" ? <div className={styles.matchPanel}><span className={styles.eyebrow}>Resultado da rodada</span><h1 id="player-title">{result?.isCorrect ? "Você acertou!" : "Quase lá"}</h1><p className={styles.playerName}>+{result?.pointsAwarded ?? 0} pontos</p><p>{result?.isCorrect ? "Resposta correta." : "A resposta correta já foi revelada."}</p></div> : <div className={styles.matchPanel}><span className={styles.eyebrow}>Partida encerrada</span><h1 id="player-title">Ranking final</h1><ol className={styles.ranking}>{ranking.map((player) => <li key={player.id}><span>{player.displayName}</span><strong>{player.score} pts</strong></li>)}</ol></div>}<p className={styles.note} role="alert" aria-live="polite">{error}</p>{joined && <button type="button" className={styles.secondary} onClick={leave}>Sair da sala</button>}</section></main>;
}
