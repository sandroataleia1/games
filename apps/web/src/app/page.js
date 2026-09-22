"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { EVENTS } from "@quizarena/contracts";
import styles from "./page.module.css";
import { createLobbyClient, saveSession, storageKeys } from "../lib/lobby-client";

const statusLabels = { connecting: "Conectando ao servidor", connected: "Servidor conectado", reconnecting: "Reconectando", unavailable: "Servidor indisponível" };

export default function Home() {
  const router = useRouter();
  const clientRef = useRef(null);
  const [status, setStatus] = useState("connecting");
  const [quizzes, setQuizzes] = useState([]);
  const [quizId, setQuizId] = useState("");
  const [roomCode, setRoomCode] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    const client = createLobbyClient({ onStatusChange: async (next) => { setStatus(next); if (next === "connected") { const response = await client.command(EVENTS.QUIZ_LIST); if (response?.ok) { setQuizzes(response.data.quizzes); setQuizId((current) => current || response.data.quizzes[0]?.id || ""); } else setError(response?.error?.message || "Não foi possível carregar os quizzes."); } } });
    clientRef.current = client;
    return client.disconnect;
  }, []);
  async function createRoom() {
    setError("");
    const response = await clientRef.current.command(EVENTS.ROOM_CREATE, { quizId });
    if (!response?.ok) { setError(response?.error?.message || "Não foi possível criar a sala."); return; }
    saveSession(storageKeys.host(response.data.roomCode), response.data.hostToken);
    router.push(`/host/${response.data.roomCode}`);
  }
  function enterRoom(event) {
    event.preventDefault();
    const code = roomCode.trim().toUpperCase();
    if (code.length === 6) router.push(`/play/${code}`); else setError("Informe um código de sala com 6 caracteres.");
  }
  const canCreate = status === "connected" && quizId && quizzes.length > 0;
  return <main className={styles.shell}><section className={styles.board} aria-labelledby="title">
    <header className={styles.header}><div className={styles.brand}><span className={styles.mark} aria-hidden="true">Q</span><span>QuizArena</span></div><div role="status" aria-live="polite" className={`${styles.status} ${styles[status]}`}><span className={styles.statusDot} aria-hidden="true" />{statusLabels[status]}</div></header>
    <div className={styles.intro}><span className={styles.eyebrow}>O quiz da sua turma</span><h1 id="title">Jogue na TV.<br /><em>Responda pelo celular.</em></h1><p className={styles.description}>Escolha um quiz publicado, abra uma sala e convide sua turma para entrar com um código.</p></div>
    <div className={styles.actions}><section className={styles.create} aria-labelledby="create-title"><h2 id="create-title">Na tela principal</h2><label htmlFor="quiz">Quiz publicado</label><select id="quiz" value={quizId} onChange={(event) => setQuizId(event.target.value)} disabled={status !== "connected" || quizzes.length === 0}><option value="">{status === "connected" ? "Selecione um quiz" : "Aguardando servidor"}</option>{quizzes.map((quiz) => <option key={quiz.id} value={quiz.id}>{quiz.title} ({quiz.questionCount})</option>)}</select><button type="button" disabled={!canCreate} onClick={createRoom} className={styles.primary}>Criar partida</button></section><section className={styles.join} aria-labelledby="join-title"><h2 id="join-title">No seu celular</h2><form onSubmit={enterRoom}><label htmlFor="room-code">Código da sala</label><div className={styles.joinRow}><input id="room-code" value={roomCode} onChange={(event) => setRoomCode(event.target.value.replace(/[^a-z0-9]/gi, "").slice(0, 6))} placeholder="Digite o código" autoComplete="off" maxLength={6} /><button type="submit" disabled={status !== "connected"} className={styles.secondary}>Entrar na sala</button></div></form></section></div>
    <p className={styles.note} role="alert" aria-live="polite">{error || (status === "connected" && quizzes.length === 0 ? "Nenhum quiz publicado está disponível para criar uma sala." : "")}</p>
  </section></main>;
}
