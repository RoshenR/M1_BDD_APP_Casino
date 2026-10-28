import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, session } from '../lib/api';
import { jetons } from '../lib/solde';
import { chargerJeux, type Jeu } from '../lib/jeux';
import { SousLeCapot } from '../components/SousLeCapot';

interface Compte {
  code: string;
  nom: string;
  nb_parties: number;
  marge_casino: number;
  rtp_reel: number | null;
  rtp_theorique: number;
}

/* Chaque table du salon montre son jeu en miniature, sur son propre feutre. */
function Miniature({ code }: { code: string }) {
  if (code === 'roulette') {
    return (
      <div className="mini-roue" aria-hidden="true">
        {[15, 19, 4, 21, 0, 32, 26].map((n, i) => (
          <span key={i} style={{
            background: n === 0 ? 'var(--case-vert)' : [32, 19, 21].includes(n) ? 'var(--case-rouge)' : 'var(--case-noir)',
          }}>{n}</span>
        ))}
      </div>
    );
  }
  if (code === 'machine') {
    return (
      <div className="fenetre" aria-hidden="true" style={{ padding: 8, gap: 6 }}>
        {['🍒', '7️⃣', '🍒'].map((s, i) => (
          <div key={i} className="rouleau" style={{ width: 54, fontSize: '1.9rem' }}><span>{s}</span></div>
        ))}
      </div>
    );
  }
  return (
    <div className="cartes" aria-hidden="true" style={{ minHeight: 0 }}>
      {[['A', '♠', false], ['R', '♥', true]].map(([r, c, rouge]) => (
        <div key={String(r)} className={`carte ${rouge ? 'carte--rouge' : ''}`} style={{ transform: rouge ? 'rotate(6deg)' : 'rotate(-6deg)' }}>
          <span className="carte__coin">{r}<br />{c}</span>
          <span className="carte__centre">{c}</span>
        </div>
      ))}
    </div>
  );
}

const ACCROCHE: Record<string, string> = {
  roulette: 'Une case, une bille, 37 issues.',
  machine: 'Trois rouleaux, sept symboles.',
  blackjack: 'Vous contre le croupier, à 21.',
};

const pct = (x: number) => `${(x * 100).toFixed(2).replace('.', ',')} %`;

export function Lobby() {
  const [jeux, setJeux] = useState<Jeu[]>([]);
  const [comptes, setComptes] = useState<Compte[]>([]);
  const joueur = session.joueur();

  useEffect(() => {
    chargerJeux().then(setJeux).catch(() => {});
    api.get<Compte[]>('/statistiques/jeux').then(setComptes).catch(() => {});
  }, []);

  // Une echelle commune aux barres : de 85 % a 100 %, la ou tout se joue.
  const largeur = (x: number) => `${Math.max(0, Math.min(1, (x - 0.85) / 0.15)) * 100}%`;

  return (
    <>
      <header className="page-titre">
        <h1>{joueur ? `Bonsoir, ${joueur.pseudo}` : 'Choisissez votre table'}</h1>
        <p className="chapeau">
          {joueur
            ? 'Trois tables sont ouvertes ce soir.'
            : 'Créez un compte pour recevoir 100 jetons et jouer aux trois tables.'}
        </p>
      </header>

      <div className="salon-tables">
        {jeux.map((j) => (
          <Link key={j.id} to={`/${j.code}`} className="salon-table">
            <div className="table"><Miniature code={j.code} /></div>
            <div className="salon-table__bas">
              <h2>{j.nom === 'Machine a sous' ? 'Machine à sous' : j.nom}</h2>
              <span className="discret">{jetons(j.mise_min)} à {jetons(j.mise_max)} jetons</span>
            </div>
            <p className="discret" style={{ margin: 0 }}>{ACCROCHE[j.code]}</p>
          </Link>
        ))}
      </div>

      {!joueur && (
        <p style={{ marginTop: '2rem' }}>
          <Link to="/inscription" className="bouton bouton--principal">Créer un compte</Link>{' '}
          <Link to="/connexion" className="bouton">J'ai déjà un compte</Link>
        </p>
      )}

      <section className="section" aria-labelledby="comptes-titre">
        <h2 id="comptes-titre">Le casino tient-il parole ?</h2>
        <p className="legende-comptes">
          Chaque jeu annonce la part des mises qu'il redistribue aux joueurs (le RTP).
          Voici ce qu'il a réellement redistribué, calculé en direct sur toutes les parties
          jouées.
        </p>

        <div className="comptes">
          {comptes.map((c) => {
            const reel = Number(c.rtp_reel ?? 0);
            const annonce = Number(c.rtp_theorique);
            const ecart = (reel - annonce) * 100;
            return (
              <div key={c.code}>
                <div className="compte__tete">
                  <h3>{c.nom === 'Machine a sous' ? 'Machine à sous' : c.nom}</h3>
                  <span className="discret">
                    {Number(c.nb_parties).toLocaleString('fr-FR')} parties,{' '}
                    {jetons(Math.round(Number(c.marge_casino)))} jetons gardés par le casino
                  </span>
                </div>
                <div className="barre">
                  <span>Annoncé</span>
                  <div className="barre__piste">
                    <div className="barre__rempli" style={{ width: largeur(annonce), background: 'var(--brume-fonce)' }} />
                  </div>
                  <span className="barre__valeur">{pct(annonce)}</span>
                </div>
                <div className="barre">
                  <span>Redistribué</span>
                  <div className="barre__piste">
                    <div className="barre__rempli" style={{ width: largeur(reel), background: 'var(--ivoire)' }} />
                  </div>
                  <span className="barre__valeur">{pct(reel)}</span>
                </div>
                <p className="discret" style={{ margin: '0.35rem 0 0', fontSize: '0.88rem' }}>
                  {Math.abs(ecart) < 0.5
                    ? 'Conforme à l\'annonce.'
                    : `Écart de ${ecart > 0 ? '+' : ''}${ecart.toFixed(1).replace('.', ',')} point${Math.abs(ecart) >= 2 ? 's' : ''} : la moyenne n'a pas encore convergé.`}
                </p>
              </div>
            );
          })}
        </div>

        <SousLeCapot>
          <p>
            Ces chiffres viennent de la vue <code>v_resultats_par_jeu</code>, recalculée à
            chaque affichage sur les 800 000 parties de la base. Le filtre sur les parties
            terminées est placé dans le <code>ON</code> du <code>LEFT JOIN</code> et non dans
            le <code>WHERE</code> : un jeu sans aucune partie apparaîtrait à zéro au lieu de
            disparaître.
          </p>
          <p>
            La machine à sous s'écarte de son annonce à cause de sa combinaison × 1000, qui
            sort environ une fois sur 16 000 : quelques sorties de plus ou de moins suffisent
            à déplacer la moyenne de plusieurs points.
          </p>
        </SousLeCapot>
      </section>
    </>
  );
}
