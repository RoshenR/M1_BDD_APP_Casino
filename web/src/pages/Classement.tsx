import { useEffect, useState } from 'react';
import { api, session } from '../lib/api';
import { signe } from '../lib/solde';
import { SousLeCapot } from '../components/SousLeCapot';

interface Ligne {
  rang: number;
  pseudo: string;
  nb_parties: number;
  resultat_net: number;
}

interface LigneDirect {
  pseudo: string;
  net: number;
}

export function Classement() {
  const [general, setGeneral] = useState<Ligne[] | null>(null);
  const [direct, setDirect] = useState<LigneDirect[] | null>(null);
  const moi = session.joueur()?.pseudo;

  useEffect(() => {
    api.get<Ligne[]>('/classement?limite=25').then(setGeneral).catch(() => setGeneral([]));
    api.get<LigneDirect[]>('/classement/live?limite=25').then(setDirect).catch(() => setDirect([]));
  }, []);

  return (
    <>
      <header className="page-titre">
        <h1>Classement</h1>
        <p className="chapeau">
          Les joueurs qui ont le plus gagné. À gauche depuis l'ouverture du casino,
          à droite depuis ce soir.
        </p>
      </header>

      <div className="colonnes">
        <section aria-labelledby="general-titre">
          <h2 id="general-titre" style={{ marginBottom: '1rem' }}>Depuis l'ouverture</h2>
          <div className="tableau-conteneur">
            <table className="donnees">
              <thead>
                <tr><th>Rang</th><th>Joueur</th><th className="nombre">Parties</th><th className="nombre">Gains nets</th></tr>
              </thead>
              <tbody>
                {general === null && <tr><td colSpan={4} className="vide">Calcul du classement…</td></tr>}
                {general?.map((l) => (
                  <tr key={l.pseudo} data-moi={l.pseudo === moi} data-podium={l.rang <= 3 ? l.rang : undefined}>
                    <td className="rang">{l.rang}</td>
                    <td>{l.pseudo}{l.pseudo === moi && <span className="discret"> (vous)</span>}</td>
                    <td className="nombre discret">{Number(l.nb_parties).toLocaleString('fr-FR')}</td>
                    <td className={`nombre ${Number(l.resultat_net) >= 0 ? 'gain' : 'perte'}`}>{signe(Number(l.resultat_net))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section aria-labelledby="direct-titre">
          <h2 id="direct-titre" style={{ marginBottom: '1rem' }}>Ce soir</h2>
          <div className="tableau-conteneur">
            <table className="donnees">
              <thead>
                <tr><th>Rang</th><th>Joueur</th><th className="nombre">Gains nets</th></tr>
              </thead>
              <tbody>
                {direct === null && <tr><td colSpan={3} className="vide">Chargement…</td></tr>}
                {direct?.length === 0 && (
                  <tr><td colSpan={3} className="vide">Personne n'a encore joué ce soir. Soyez le premier à une table.</td></tr>
                )}
                {direct?.map((l, i) => (
                  <tr key={l.pseudo} data-moi={l.pseudo === moi} data-podium={i < 3 ? i + 1 : undefined}>
                    <td className="rang">{i + 1}</td>
                    <td>{l.pseudo}{l.pseudo === moi && <span className="discret"> (vous)</span>}</td>
                    <td className={`nombre ${l.net >= 0 ? 'gain' : 'perte'}`}>{signe(l.net)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <SousLeCapot>
        <p>
          Les deux colonnes répondent à la même question avec deux outils. À gauche, la
          fonction PostgreSQL <code>classement()</code> recalcule tout depuis les 800 000
          parties : c'est exact et transactionnel, mais coûteux. À droite, un ensemble trié
          Redis est incrémenté à chaque partie (<code>ZINCRBY</code>) : c'est instantané,
          mais volatil, et il ne connaît que les parties jouées depuis son démarrage.
        </p>
        <p>
          Un troisième outil existe dans le projet : la vue matérialisée{' '}
          <code>mv_stats_quotidiennes</code>, qui stocke le résultat d'un calcul coûteux et ne
          change qu'au rafraîchissement. Trois compromis entre fraîcheur, coût et fiabilité.
        </p>
      </SousLeCapot>
    </>
  );
}
