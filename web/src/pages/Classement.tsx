import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { jetons } from '../lib/solde';

interface Ligne {
  rang: number;
  pseudo: string;
  nb_parties: number;
  resultat_net: number;
}

interface LigneLive {
  pseudo: string;
  net: number;
}

export function Classement() {
  const [exact, setExact] = useState<Ligne[]>([]);
  const [live, setLive] = useState<LigneLive[]>([]);

  useEffect(() => {
    api.get<Ligne[]>('/classement?limite=20').then(setExact).catch(() => {});
    api.get<LigneLive[]>('/classement/live?limite=20').then(setLive).catch(() => {});
  }, []);

  return (
    <>
      <h1>Classement</h1>
      <p className="sous-titre">
        Le meme classement, calcule de deux facons. C&apos;est la comparaison la plus
        parlante du projet sur le choix d&apos;un magasin de donnees.
      </p>

      <div className="grille" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))' }}>
        {/* --- PostgreSQL ---------------------------------------------------- */}
        <div className="carte">
          <h2 style={{ marginTop: 0 }}>PostgreSQL — exact</h2>
          <p className="discret">
            Fonction <code className="mono">classement()</code> : agregation sur les
            800 000 parties a chaque appel. Transactionnel, reconstructible,
            toujours juste. Plus couteux.
          </p>
          <div className="tableau-defilant">
            <table>
              <thead>
                <tr><th>#</th><th>Joueur</th><th className="num">Parties</th><th className="num">Net</th></tr>
              </thead>
              <tbody>
                {exact.map((l) => (
                  <tr key={l.pseudo}>
                    <td>{l.rang}</td>
                    <td>{l.pseudo}</td>
                    <td className="num">{Number(l.nb_parties).toLocaleString('fr-FR')}</td>
                    <td className={`num ${Number(l.resultat_net) >= 0 ? 'gain' : 'perte'}`}>
                      {jetons(l.resultat_net)}
                    </td>
                  </tr>
                ))}
                {exact.length === 0 && <tr><td colSpan={4} className="discret">Chargement...</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        {/* --- Redis --------------------------------------------------------- */}
        <div className="carte">
          <h2 style={{ marginTop: 0 }}>Redis — temps reel</h2>
          <p className="discret">
            ZSET mis a jour par <code className="mono">ZINCRBY</code> a chaque partie.
            Instantane et O(log n), mais volatil : il ne contient que les parties
            jouees depuis le demarrage de Redis. Un cache d&apos;animation, pas une
            source de verite.
          </p>
          <div className="tableau-defilant">
            <table>
              <thead><tr><th>#</th><th>Joueur</th><th className="num">Net</th></tr></thead>
              <tbody>
                {live.map((l, i) => (
                  <tr key={l.pseudo}>
                    <td>{i + 1}</td>
                    <td>{l.pseudo}</td>
                    <td className={`num ${l.net >= 0 ? 'gain' : 'perte'}`}>{jetons(l.net)}</td>
                  </tr>
                ))}
                {live.length === 0 && (
                  <tr><td colSpan={3} className="discret">Aucune partie depuis le demarrage de Redis.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <p className="notice">
        Il existe une troisieme voie dans ce projet : la vue materialisee
        <code className="mono"> mv_stats_quotidiennes</code>, qui stocke le resultat
        d&apos;un agregat coûteux et ne bouge qu&apos;au <code className="mono">REFRESH</code>.
        Trois outils, trois compromis entre fraicheur, coût et fiabilite.
      </p>
    </>
  );
}
