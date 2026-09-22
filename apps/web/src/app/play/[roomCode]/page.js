"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { EVENTS } from "@quizarena/contracts";
import { createLobbyClient, saveSession, sessionValue, storageKeys } from "../../../lib/lobby-client";
import styles from "../../page.module.css";

export default function PlayerLobby() {
  const { roomCode } = useParams();
  const router = useRouter();
  const [status, setStatus] = useState("connecting");
  const [state, setState] = useState(null);
  const [name, setName] = useState("");
  const [joined, setJoined] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!roomCode) return undefined;
    const client = createLobbyClient({ onStatusChange: async (next) => { setStatus(next); if (next === "connected") { const saved = sessionValue(storageKeys.player(roomCode)); if (!saved) return; try { const credentials = JSON.parse(saved); const response = await client.command(EVENTS.ROOM_RESUME, { roomCode, ...credentials }); if (response?.ok) { setJoined(true); setState(response.data.state); } else setError(response?.error?.message || "Não foi possível reassumir sua entrada."); } catch { setError("A credencial da sala está inválida."); } } }, onStateChange: setState });
    window.__quizArenaPlayerClient = client;
    return () => { delete window.__quizArenaPlayerClient; client.disconnect(); };
  }, [roomCode]);
  async function join(event) {
    event.preventDefault(); setError("");
    const response = await window.__quizArenaPlayerClient?.command(EVENTS.ROOM_JOIN, { roomCode, displayName: name });
    if (!response?.ok) { setError(response?.error?.message || "Não foi possível entrar na sala."); return; }
    saveSession(storageKeys.player(roomCode), JSON.stringify({ participantId: response.data.participantId, reconnectToken: response.data.reconnectToken })); setJoined(true); setState(response.data.state);
  }
  async function leave() { await window.__quizArenaPlayerClient?.command(EVENTS.ROOM_LEAVE, { roomCode }); sessionStorage.removeItem(storageKeys.player(roomCode)); router.push("/"); }
  return <main className={styles.shell}><section className={styles.board} aria-labelledby="player-title"><header className={styles.header}><div className={styles.brand}><span className={styles.mark}>Q</span><span>QuizArena</span></div><div className={styles.status} role="status" aria-live="polite"><span className={styles.statusDot} />{status === "connected" ? "Conectado" : status === "reconnecting" ? "Reconectando" : "Aguardando conexão"}</div></header>{!joined ? <div className={styles.playerForm}><span className={styles.eyebrow}>Você foi convidado</span><h1 id="player-title">Entre na sala <em>{roomCode}</em></h1><p>Digite seu nome para aparecer no lobby.</p><form onSubmit={join}><label htmlFor="display-name">Seu nome</label><input id="display-name" value={name} onChange={(event) => setName(event.target.value)} minLength={2} maxLength={24} autoComplete="name" autoFocus /><button type="submit" className={styles.primary} disabled={status !== "connected" || name.trim().length < 2}>Entrar no lobby</button></form></div> : <div className={styles.playerForm}><span className={styles.eyebrow}>Você está na sala</span><h1 id="player-title">Aguardando o organizador iniciar</h1><p className={styles.playerName}>{state?.players?.find((player) => player.id === JSON.parse(sessionValue(storageKeys.player(roomCode)) || "{}").participantId)?.displayName || name}</p><p>{state?.playerCount ?? 0} jogador(es) na sala</p><button type="button" className={styles.secondary} onClick={leave}>Sair da sala</button></div>}<p className={styles.note} role="alert" aria-live="polite">{error}</p></section></main>;
}