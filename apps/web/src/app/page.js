"use client";
import { useEffect, useState } from "react";
import styles from "./page.module.css";
import { connectRealtime } from "../lib/realtime-client";

const labels = {
  connecting: "Conectando ao servidor",
  connected: "Servidor conectado",
  unavailable: "Servidor indisponível",
};

export default function Home() {
  const [status, setStatus] = useState("connecting");
  useEffect(() => connectRealtime({ onStatusChange: setStatus }), []);
  return (
    <main className={styles.shell}>
      <section className={styles.board} aria-labelledby="title">
        <header className={styles.header}>
          <div className={styles.brand}>
            <span className={styles.mark} aria-hidden="true">
              Q
            </span>
            <span>QuizArena</span>
          </div>
          <div
            role="status"
            aria-live="polite"
            className={`${styles.status} ${styles[status]}`}
          >
            <span className={styles.statusDot} aria-hidden="true" />
            {labels[status]}
          </div>
        </header>
        <div className={styles.intro}>
          <span className={styles.eyebrow}>O quiz da sua turma</span>
          <h1 id="title">
            Jogue na TV.
            <br />
            <em>Responda pelo celular.</em>
          </h1>
          <div className={styles.devices} aria-hidden="true">
            <div className={styles.tv}>
              <span>?</span>
              <div className={styles.answers}>
                <i />
                <i />
                <i />
                <i />
              </div>
            </div>
            <div className={styles.phone}>
              <i />
              <i />
              <i />
              <i />
            </div>
          </div>
        </div>
        <div className={styles.actions}>
          <section className={styles.create} aria-labelledby="create-title">
            <h2 id="create-title">Na tela principal</h2>
            <button type="button" disabled className={styles.primary}>
              Criar partida
            </button>
          </section>
          <section className={styles.join} aria-labelledby="join-title">
            <h2 id="join-title">No seu celular</h2>
            <label htmlFor="room-code">Código da sala</label>
            <div className={styles.joinRow}>
              <input
                id="room-code"
                placeholder="Digite o código"
                autoComplete="off"
                maxLength={12}
                aria-describedby="coming-soon"
              />
              <button type="button" disabled className={styles.secondary}>
                Entrar na sala
              </button>
            </div>
          </section>
        </div>
        <p id="coming-soon" className={styles.note}>
          Criar partidas e entrar em salas estarão disponíveis em breve.
        </p>
      </section>
    </main>
  );
}
