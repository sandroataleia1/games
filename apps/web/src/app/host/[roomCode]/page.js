"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { EVENTS } from "@quizarena/contracts";
import { createLobbyClient, sessionValue, storageKeys } from "../../../lib/lobby-client";
import styles from "../../page.module.css";

export default function HostLobby() {
  const { roomCode } = useParams();
  const router = useRouter();
  const [status, setStatus] = useState("connecting");
  const [state, setState] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!roomCode) return undefined;
    const client = createLobbyClient({ onStatusChange: async (next) => { setStatus(next); if (next === "connected") { const hostToken = sessionValue(storageKeys.host(roomCode)); if (!hostToken) { setError("A credencial desta sala não está disponível neste navegador."); return; } const response = await client.command(EVENTS.HOST_RESUME, { roomCode, hostToken }); if (response?.ok) setState(response.data.state); else setError(response?.error?.message || "Não foi possível reassumir a sala."); } }, onStateChange: setState });
    return client.disconnect;
  }, [roomCode]);
  return <main className={styles.shell}><section className={styles.board} aria-labelledby="host-title"><header className={styles.header}><div className={styles.brand}><span className={styles.mark}>Q</span><span>QuizArena / Organizador</span></div><div className={styles.status} role="status" aria-live="polite"><span className={styles.statusDot} />{status === "connected" ? "Conectado" : status === "reconnecting" ? "Reconectando" : "Aguardando conexão"}</div></header><div className={styles.lobbyHero}><span className={styles.eyebrow}>Código da sala</span><h1 id="host-title" className={styles.roomCode}>{roomCode}</h1><p>{state?.quiz?.title || "Carregando quiz..."}</p></div>{error ? <p className={styles.note} role="alert">{error}</p> : <><div className={styles.playerHeader}><h2>Jogadores</h2><strong>{state?.playerCount ?? 0} / {state?.maxPlayers ?? 20}</strong></div><ul className={styles.players}>{state?.players?.map((player) => <li key={player.id}><span className={styles.playerDot} data-status={player.connectionStatus} />{player.displayName}<small>{player.connectionStatus === "CONNECTED" ? "conectado" : "desconectado"}</small></li>)}</ul><p className={styles.note}>Aguarde os jogadores entrarem. O botão de iniciar ficará disponível em um próximo incremento.</p></>}<button type="button" className={styles.secondary} onClick={() => router.push("/")}>Voltar ao início</button></section></main>;
}