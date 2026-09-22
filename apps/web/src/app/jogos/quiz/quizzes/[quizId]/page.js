"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { EVENTS } from "@quizarena/contracts";
import styles from "../../../../page.module.css";
import { api } from "../../../../../lib/api";
import { createLobbyClient, saveSession, storageKeys } from "../../../../../lib/lobby-client";
import { withNext } from "../../../../../lib/safe-redirect";

const roomStatusLabel = { WAITING: "Aguardando", ACTIVE: "Em partida", FINISHED: "Encerrada", CANCELLED: "Cancelada" };

export default function QuizRooms() {
  const { quizId } = useParams();
  const router = useRouter();
  const clientRef = useRef(null);
  const [user, setUser] = useState(null);
  const [checked, setChecked] = useState(false);
  const [status, setStatus] = useState("connecting");
  const [quiz, setQuiz] = useState(null);
  const [rooms, setRooms] = useState(null);
  const [visibility, setVisibility] = useState("PUBLIC");
  const [hostPlays, setHostPlays] = useState(true);
  const [joinCode, setJoinCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api("/auth/me").then((data) => setUser(data.user)).catch(() => setUser(null)).finally(() => setChecked(true));
  }, []);

  useEffect(() => {
    if (!checked) return;
    if (!user) { router.replace(withNext("/login", `/jogos/quiz/quizzes/${quizId}`)); return; }
  }, [checked, user, quizId, router]);

  useEffect(() => {
    if (!checked || !user || !quizId) return undefined;
    const client = createLobbyClient({
      onStatusChange: async (next) => {
        setStatus(next);
        if (next !== "connected") return;
        const quizList = await client.command(EVENTS.QUIZ_LIST, {});
        if (quizList?.ok) setQuiz(quizList.data.quizzes.find((item) => item.id === quizId) || null);
        const watched = await client.command(EVENTS.ROOM_WATCH, { quizId });
        if (watched?.ok) setRooms(watched.data.rooms);
        else setError(watched?.error?.message || "Não foi possível carregar as salas.");
      },
      onRoomCatalog: (payload) => { if (payload.quizId === quizId) setRooms(payload.rooms); },
    });
    clientRef.current = client;
    return () => { client.command(EVENTS.ROOM_UNWATCH, { quizId }).catch(() => {}); client.disconnect(); };
  }, [checked, user, quizId]);

  async function createRoom() {
    setBusy(true);
    setError("");
    const response = await clientRef.current.command(EVENTS.ROOM_CREATE, { quizId, visibility, hostPlays });
    setBusy(false);
    if (!response?.ok) { setError(response?.error?.message || "Não foi possível criar a sala."); return; }
    saveSession(storageKeys.host(response.data.roomCode), response.data.hostToken);
    if (response.data.playing) saveSession(storageKeys.hostPlaying(response.data.roomCode), "1");
    router.push(`/host/${response.data.roomCode}`);
  }
  function enterByCode(event) {
    event.preventDefault();
    const code = joinCode.trim().toUpperCase();
    if (code.length !== 6) { setError("Informe um código de sala com 6 caracteres."); return; }
    router.push(`/salas/${code}`);
  }

  if (!checked || !user) return null;

  return (
    <main className={styles.shell}>
      <section className={styles.board} aria-labelledby="quiz-title">
        <header className={styles.header}>
          <div className={styles.brand}><span className={styles.mark} aria-hidden="true">Q</span><span>QuizArena / Quiz</span></div>
          <Link href="/jogos/quiz">← Quizzes</Link>
        </header>
        <div className={styles.intro} style={{ padding: "30px 0" }}>
          <h1 id="quiz-title">{quiz?.title || "Carregando..."}</h1>
          {quiz?.description && <p className={styles.description}>{quiz.description}</p>}
          {quiz && (
            <p className={styles.note}>
              {quiz.questionCount} pergunta(s) · aprox. {Math.round((quiz.estimatedSeconds || 0) / 60)} min
              {quiz.ownerName ? ` · por ${quiz.ownerName}` : ""}
            </p>
          )}
        </div>

        <section aria-labelledby="create-room-title" style={{ borderTop: "1px solid var(--line)", paddingTop: 24 }}>
          <h2 id="create-room-title" style={{ fontSize: 16 }}>Criar sala</h2>
          <div className={styles.visibilityToggle} role="radiogroup" aria-label="Visibilidade da sala">
            <label><input type="radio" name="visibility" checked={visibility === "PUBLIC"} onChange={() => setVisibility("PUBLIC")} /> Pública</label>
            <label><input type="radio" name="visibility" checked={visibility === "PRIVATE"} onChange={() => setVisibility("PRIVATE")} /> Privada</label>
          </div>
          <div className={styles.visibilityToggle} role="radiogroup" aria-label="Participação do organizador" style={{ marginTop: 10 }}>
            <label><input type="radio" name="hostPlays" checked={hostPlays} onChange={() => setHostPlays(true)} /> Organizar e jogar</label>
            <label><input type="radio" name="hostPlays" checked={!hostPlays} onChange={() => setHostPlays(false)} /> Somente organizar</label>
          </div>
          <button type="button" className={styles.primary} style={{ marginTop: 14 }} disabled={busy || status !== "connected"} onClick={createRoom}>
            {busy ? "Criando…" : "Criar sala"}
          </button>
        </section>

        <section aria-labelledby="rooms-title" style={{ borderTop: "1px solid var(--line)", paddingTop: 24, marginTop: 24 }}>
          <h2 id="rooms-title" style={{ fontSize: 16 }}>Salas abertas</h2>
          {status !== "connected" && <p className={styles.note}>Conectando ao servidor…</p>}
          {status === "connected" && rooms === null && <p className={styles.note}>Carregando salas…</p>}
          {status === "connected" && rooms?.length === 0 && <p className={styles.note}>Nenhuma sala pública aberta para este quiz agora. Crie a sua.</p>}
          {rooms?.length > 0 && (
            <ul className={styles.roomList}>
              {rooms.map((room) => (
                <li className={styles.roomCard} key={room.roomCode}>
                  <div className={styles.roomMeta}>
                    <strong>{room.roomCode}</strong>
                    <small>{room.hostName ? `Organizado por ${room.hostName}` : "Sala"} · {room.playerCount}/{room.maxPlayers} · {roomStatusLabel[room.status] || room.status}</small>
                  </div>
                  <Link className={styles.secondary} href={room.canJoin ? `/salas/${room.roomCode}` : "#"} aria-disabled={!room.canJoin}>
                    {room.canJoin ? "Entrar" : "Cheia"}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="join-code-title" style={{ borderTop: "1px solid var(--line)", paddingTop: 24, marginTop: 24 }}>
          <h2 id="join-code-title" style={{ fontSize: 16 }}>Entrar com um código</h2>
          <form onSubmit={enterByCode} className={styles.joinRow}>
            <input value={joinCode} onChange={(event) => setJoinCode(event.target.value.replace(/[^a-z0-9]/gi, "").slice(0, 6))} placeholder="Código da sala" maxLength={6} aria-label="Código da sala" />
            <button type="submit" className={styles.secondary}>Entrar</button>
          </form>
        </section>
        <p className={styles.note} role="alert" aria-live="polite">{error}</p>
      </section>
    </main>
  );
}
