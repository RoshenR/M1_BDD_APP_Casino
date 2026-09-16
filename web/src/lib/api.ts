/**
 * Client HTTP. Le front ne connait QUE cette API : il n'a aucune connaissance
 * du schema, des tables, ni meme du fait que la logique de jeu est en PL/pgSQL.
 * C'est tout l'interet d'un back dissocie.
 */
const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

const CLE_TOKEN = 'casino.token';
const CLE_REFRESH = 'casino.refresh';
const CLE_JOUEUR = 'casino.joueur';

export interface Joueur {
  id: number;
  pseudo: string;
  role: string;
}

export const session = {
  token: () => localStorage.getItem(CLE_TOKEN),
  joueur: (): Joueur | null => {
    const brut = localStorage.getItem(CLE_JOUEUR);
    return brut ? (JSON.parse(brut) as Joueur) : null;
  },
  ouvrir(token: string, refresh: string, joueur: Joueur) {
    localStorage.setItem(CLE_TOKEN, token);
    localStorage.setItem(CLE_REFRESH, refresh);
    localStorage.setItem(CLE_JOUEUR, JSON.stringify(joueur));
  },
  fermer() {
    [CLE_TOKEN, CLE_REFRESH, CLE_JOUEUR].forEach((c) => localStorage.removeItem(c));
  },
};

export class ErreurApi extends Error {
  constructor(public readonly statut: number, message: string) {
    super(message);
  }
}

async function appel<T>(chemin: string, options: RequestInit = {}, reessayer = true): Promise<T> {
  const token = session.token();
  const reponse = await fetch(`${BASE}${chemin}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });

  // Access token expire (15 min) : on le renouvelle avec le refresh token,
  // qui est revocable cote Redis, puis on rejoue la requete une seule fois.
  if (reponse.status === 401 && reessayer && localStorage.getItem(CLE_REFRESH)) {
    const ok = await rafraichir();
    if (ok) return appel<T>(chemin, options, false);
  }

  const corps = await reponse.json().catch(() => ({}));
  if (!reponse.ok) {
    throw new ErreurApi(reponse.status, (corps as { erreur?: string }).erreur ?? 'Erreur inattendue');
  }
  return corps as T;
}

async function rafraichir(): Promise<boolean> {
  try {
    const r = await fetch(`${BASE}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh: localStorage.getItem(CLE_REFRESH) }),
    });
    if (!r.ok) {
      session.fermer();
      return false;
    }
    const d = (await r.json()) as { token: string; refresh: string; joueur: Joueur };
    session.ouvrir(d.token, d.refresh, d.joueur);
    return true;
  } catch {
    session.fermer();
    return false;
  }
}

export const api = {
  get: <T>(chemin: string) => appel<T>(chemin),
  post: <T>(chemin: string, corps?: unknown) =>
    appel<T>(chemin, { method: 'POST', body: JSON.stringify(corps ?? {}) }),
  patch: <T>(chemin: string, corps: unknown) =>
    appel<T>(chemin, { method: 'PATCH', body: JSON.stringify(corps) }),
};
