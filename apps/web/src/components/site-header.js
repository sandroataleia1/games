"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import styles from "./site-header.module.css";
import { api } from "../lib/api";

// Shared header for the portal (home, /jogos). Pages that already had their
// own header (the Quiz game pages, room pages) keep it - this component is
// only wired into the two portal-level routes this stage touches.
export function SiteHeader() {
  const [user, setUser] = useState(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    api("/auth/me").then((data) => setUser(data.user)).catch(() => setUser(null)).finally(() => setChecked(true));
  }, []);

  async function logout() {
    await api("/auth/logout", { method: "POST", body: "{}" });
    setUser(null);
  }

  return (
    <header className={styles.header}>
      <Link href="/" className={styles.brand}>
        <span className={styles.brandMark} aria-hidden="true">M</span>
        <span className={styles.brandName}>MultyGames</span>
      </Link>
      <nav className={styles.nav} aria-label="Principal">
        {checked && user ? (
          <>
            <span className={styles.accountName}>Olá, {user.name}</span>
            <Link href="/painel">Meu painel</Link>
            <button type="button" onClick={logout}>Sair</button>
          </>
        ) : (
          <>
            <Link href="/login">Entrar</Link>
            <Link className={styles.cta} href="/cadastro">Criar conta</Link>
          </>
        )}
      </nav>
    </header>
  );
}
