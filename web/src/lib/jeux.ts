/** Bornes de mise de chaque jeu, lues une seule fois depuis l'API. */
import { useEffect, useState } from 'react';
import { api } from './api';

export interface Jeu {
  id: number;
  code: string;
  nom: string;
  mise_min: number;
  mise_max: number;
  rtp_theorique: number;
}

let cache: Promise<Jeu[]> | null = null;

export function chargerJeux(): Promise<Jeu[]> {
  cache ??= api.get<Jeu[]>('/jeux').catch((e) => {
    cache = null;
    throw e;
  });
  return cache;
}

export function useJeu(code: string) {
  const [jeu, setJeu] = useState<Jeu | null>(null);
  useEffect(() => {
    chargerJeux().then((js) => setJeu(js.find((j) => j.code === code) ?? null)).catch(() => {});
  }, [code]);
  return {
    min: Number(jeu?.mise_min ?? 1),
    max: Number(jeu?.mise_max ?? 500),
  };
}

/** Respecte la preference systeme « reduire les animations ». */
export const mouvementReduit = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export const attendre = (ms: number) => new Promise((r) => setTimeout(r, ms));
