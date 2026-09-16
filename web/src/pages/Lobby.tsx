import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, session } from '../lib/api';
import { jetons } from '../lib/solde';

interface Jeu {
  id: number;
  code: string;
  nom: string;
  mise_min: number;
  mise_max: number;
  rtp_theorique: number;
}

interface StatJeu {
  code: string;
  nom: string;
  nb_parties: number;
  marge_casino: number;
  rtp_reel: number | null;
  rtp_theorique: number;
  nb_joueurs: number;
}

const ICONES: Record<string, string> = { blackjack: '🂡', roulette: '🎰', machine: '🍒' };

export function Lobby() {
  const [jeux, setJeux] = useState<Jeu[]>([]);
  const [stats, setStats] = useState<StatJeu[]>([]);
  const joueur = session.joueur();

  useEffect(() => {
    api.get<Jeu[]>('/jeux').then(setJeux).catch(() => {});
    api.get<StatJeu[]>('/statistiques/jeux').then(setStats).catch(() => {});
  }, []);

  return (
    <>
      <h1>{joueur ? `Bonsoir ${joueur.pseudo}` : 'Bienvenue au Casino'}</h1>
      <p className="sous-titre">
        Projet SQL avance — toute la logique de jeu est en PL/pgSQL, dans PostgreSQL.
      </p>

      {!joueur && (
        <div className="carte" style={{ marginBottom: '1.5rem' }}>
          <p style={{ margin: '0 0 0.75rem' }}>
            Connectez-vous pour jouer. 100 jetons offerts a l&apos;inscription.
          </p>
          <div className="boutons" style={{ justifyContent: 'flex-start' }}>
            <Link to="/connexion"><button className="principal">Connexion</button></Link>
            <Link to="/inscription"><button>Creer un compte</button></Link>
          </div>
        </div>
      )}

      <h2>Les tables</h2>
      <div className="grille">
        {jeux.map((j) => (
          <Link key={j.id} to={`/${j.code}`} style={{ textDecoration: 'none' }}>
            <div className="carte">
              <div style={{ fontSize: '2rem' }}>{ICONES[j.code]}</div>
              <h3 style={{ margin: '0.5rem 0 0.25rem', color: 'var(--texte)' }}>{j.nom}</h3>
              <p className="discret" style={{ margin: 0 }}>
                Mise {jetons(j.mise_min)} a {jetons(j.mise_max)} jetons<br />
                RTP annonce {(Number(j.rtp_theorique) * 100).toFixed(2)} %
              </p>
            </div>
          </Link>
        ))}
      </div>

      <h2>Le casino tient-il ses promesses ?</h2>
      <div className="carte">
        <p className="discret" style={{ marginTop: 0 }}>
          Chiffres calcules en direct par la vue <code className="mono">v_resultats_par_jeu</code> sur
          les 800 000 parties de la base. Le RTP reel doit converger vers le RTP annonce :
          c&apos;est la loi des grands nombres, verifiee en SQL.
        </p>
        <table>
          <thead>
            <tr>
              <th>Jeu</th>
              <th className="num">Parties</th>
              <th className="num">Joueurs</th>
              <th className="num">Marge casino</th>
              <th className="num">RTP reel</th>
              <th className="num">RTP annonce</th>
            </tr>
          </thead>
          <tbody>
            {stats.map((s) => (
              <tr key={s.code}>
                <td>{s.nom}</td>
                <td className="num">{Number(s.nb_parties).toLocaleString('fr-FR')}</td>
                <td className="num">{Number(s.nb_joueurs).toLocaleString('fr-FR')}</td>
                <td className="num">{jetons(s.marge_casino)}</td>
                <td className="num">{s.rtp_reel ? `${(Number(s.rtp_reel) * 100).toFixed(2)} %` : '—'}</td>
                <td className="num discret">{(Number(s.rtp_theorique) * 100).toFixed(2)} %</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
