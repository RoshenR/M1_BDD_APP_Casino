/**
 * Contexte du solde. Le front ne calcule JAMAIS un solde : il affiche celui
 * que l'API renvoie, qui vient lui-meme de la base. Aucune addition cote
 * navigateur, donc aucune divergence possible avec la comptabilite.
 */
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, session } from './api';

interface ContexteSolde {
  solde: number;
  rafraichir: () => Promise<void>;
  poser: (v: number) => void;
}

const Contexte = createContext<ContexteSolde>({
  solde: 0,
  rafraichir: async () => {},
  poser: () => {},
});

export function FournisseurSolde({ children }: { children: ReactNode }) {
  const [solde, poser] = useState(0);

  const rafraichir = useCallback(async () => {
    if (!session.token()) return;
    try {
      const r = await api.get<{ solde: number }>('/moi/solde');
      poser(Number(r.solde ?? 0));
    } catch {
      /* non connecte */
    }
  }, []);

  useEffect(() => {
    void rafraichir();
  }, [rafraichir]);

  return <Contexte.Provider value={{ solde, rafraichir, poser }}>{children}</Contexte.Provider>;
}

export const useSolde = () => useContext(Contexte);

/** 49805 -> « 49 805 », 12.5 -> « 12,50 » : pas de centimes inutiles. */
export const jetons = (n: number | string | undefined) => {
  const v = Number(n ?? 0);
  return new Intl.NumberFormat('fr-FR', {
    minimumFractionDigits: Number.isInteger(v) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(v);
};

/** Montant signe pour les gains et pertes : « +40 », « −25 ». */
export const signe = (n: number) => (n > 0 ? `+${jetons(n)}` : n < 0 ? `−${jetons(-n)}` : '0');
