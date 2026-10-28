import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { jetons, signe, useSolde } from '../lib/solde';
import { useJeu } from '../lib/jeux';
import { Mise } from '../components/Jetons';
import { Historique } from '../components/Historique';
import { SousLeCapot } from '../components/SousLeCapot';

interface Main {
  cartes: string[];
  total: number | null;
}

interface Partie {
  partie_id: number;
  mise: number;
  gain: number;
  statut: 'en_cours' | 'terminee';
  resultat: 'gagne' | 'perdu' | 'egalite' | 'blackjack' | null;
  joueur: Main;
  croupier: Main;
  actions: string[];
  solde?: number;
}

const VERDICT: Record<string, string> = {
  blackjack: 'Blackjack !',
  gagne: 'Gagné',
  egalite: 'Égalité',
  perdu: 'Perdu',
};

/* Une main reprise apres un rechargement arrive sous forme d'indices 0..51
   (l'etat jsonb de la partie). On ne fait que les nommer pour l'affichage. */
const RANGS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'V', 'D', 'R'];
const COULEURS = ['♠', '♥', '♦', '♣'];
const nommer = (c: number) => RANGS[c % 13]! + COULEURS[Math.floor(c / 13)]!;

function Carte({ valeur, index }: { valeur: string; index: number }) {
  const style = { animationDelay: `${index * 0.12}s` };
  if (valeur === '??') {
    return <div className="carte carte--dos carte--distribuee" style={style} aria-label="Carte cachée" role="img" />;
  }
  const couleur = valeur.slice(-1);
  const rang = valeur.slice(0, -1);
  const rouge = couleur === '♥' || couleur === '♦';
  return (
    <div className={`carte carte--distribuee ${rouge ? 'carte--rouge' : ''}`} style={style} role="img" aria-label={valeur}>
      <span className="carte__coin">{rang}<br />{couleur}</span>
      <span className="carte__centre" aria-hidden="true">{couleur}</span>
      <span className="carte__coin carte__coin--bas" aria-hidden="true">{rang}<br />{couleur}</span>
    </div>
  );
}

function ZoneMain({ qui, main, cachee }: { qui: string; main: Main; cachee?: boolean }) {
  const saute = (main.total ?? 0) > 21;
  return (
    <div className="bj__main">
      <div className="bj__qui">
        {qui}
        {main.total !== null && (
          <span className={`total ${saute ? 'total--saute' : ''}`}>
            {main.total}{cachee ? ' +' : ''}
          </span>
        )}
      </div>
      <div className="cartes">
        {main.cartes.map((c, i) => <Carte key={`${i}-${c}`} valeur={c} index={i} />)}
      </div>
    </div>
  );
}

export function Blackjack() {
  const { min, max } = useJeu('blackjack');
  const { solde, poser, rafraichir } = useSolde();
  const [mise, setMise] = useState(20);
  const [partie, setPartie] = useState<Partie | null>(null);
  const [historique, setHistorique] = useState<Partie[]>([]);
  const [erreur, setErreur] = useState('');
  const [encours, setEncours] = useState(false);

  // Une main interrompue (onglet ferme, rechargement) reste en cours dans la
  // base : son etat vit dans parties.etat, pas dans le navigateur. On la reprend.
  useEffect(() => {
    api.get<{ partie_id: number; mise: number; etat: { joueur: number[]; croupier: number[] } } | null>(
      '/jeux/blackjack/en-cours',
    ).then((p) => {
      if (!p) return;
      setPartie({
        partie_id: p.partie_id,
        mise: Number(p.mise),
        gain: 0,
        statut: 'en_cours',
        resultat: null,
        joueur: { cartes: p.etat.joueur.map(nommer), total: null },
        croupier: { cartes: [nommer(p.etat.croupier[0]!), '??'], total: null },
        actions: p.etat.joueur.length === 2 ? ['tirer', 'rester', 'doubler'] : ['tirer', 'rester'],
      });
    }).catch(() => {});
  }, []);

  async function appeler(chemin: string, corps: unknown) {
    setErreur('');
    setEncours(true);
    try {
      const p = await api.post<Partie>(chemin, corps);
      setPartie(p);
      if (p.solde !== undefined) poser(Number(p.solde));
      if (p.statut === 'terminee') setHistorique((h) => [p, ...h].slice(0, 12));
    } catch (err) {
      setErreur((err as Error).message);
      await rafraichir();
    } finally {
      setEncours(false);
    }
  }

  const distribuer = () => appeler('/jeux/blackjack', { mise });
  const agir = (action: string) => appeler('/jeux/blackjack/action', { partieId: partie!.partie_id, action });

  const enJeu = partie?.statut === 'en_cours';
  const net = partie && !enJeu ? Number(partie.gain) - Number(partie.mise) : 0;
  const peutDistribuer = !encours && mise >= min && mise <= max && mise <= solde;

  return (
    <>
      <header className="page-titre">
        <h1>Blackjack</h1>
        <p className="chapeau">
          Approchez-vous de 21 sans le dépasser. Le croupier tire jusqu'à 17 ;
          un blackjack d'entrée paie 3 contre 2.
        </p>
      </header>

      <div className="jeu">
        <div>
          <section className="table" aria-label="Table de blackjack">
            {partie ? (
              <div className="bj" aria-live="polite">
                <ZoneMain qui="Croupier" main={partie.croupier} cachee={enJeu} />

                <div className="bj__verdict">
                  {!enJeu && partie.resultat && (
                    <>
                      {VERDICT[partie.resultat]}
                      <span className={`montant ${net > 0 ? 'gain' : net < 0 ? 'perte' : 'discret'}`}>
                        {net === 0 ? 'mise rendue' : `${signe(net)} jetons`}
                      </span>
                    </>
                  )}
                </div>

                <ZoneMain qui="Vous" main={partie.joueur} />
              </div>
            ) : (
              <p className="table__titre" style={{ marginTop: '6rem' }}>
                Posez vos jetons et demandez les cartes
              </p>
            )}
          </section>

          <Historique vide="Aucune main jouée pour l'instant">
            {historique.map((h) => {
              const n = Number(h.gain) - Number(h.mise);
              return (
                <span key={h.partie_id} className={`puce ${n > 0 ? 'puce--gain' : n < 0 ? 'puce--perte' : ''}`}
                      title={VERDICT[h.resultat ?? ''] ?? ''}>
                  {signe(n)}
                </span>
              );
            })}
          </Historique>
        </div>

        <aside className="panneau" aria-label={enJeu ? 'Vos actions' : 'Votre mise'}>
          {enJeu ? (
            <>
              <p className="mise__cible">
                Mise engagée : <strong>{jetons(partie!.mise)} jetons</strong>
              </p>
              <div className="bj__actions">
                {partie!.actions.includes('tirer') && (
                  <button className="bouton bouton--grand" onClick={() => void agir('tirer')} disabled={encours}>
                    Tirer une carte
                  </button>
                )}
                {partie!.actions.includes('rester') && (
                  <button className="bouton bouton--principal bouton--grand" onClick={() => void agir('rester')} disabled={encours}>
                    Rester
                  </button>
                )}
                {partie!.actions.includes('doubler') && (
                  <button
                    className="bouton"
                    onClick={() => void agir('doubler')}
                    disabled={encours || Number(partie!.mise) > solde}
                  >
                    Doubler la mise et tirer une dernière carte
                  </button>
                )}
              </div>
            </>
          ) : (
            <>
              <Mise valeur={mise} onChange={setMise} min={min} max={max} solde={solde} disabled={encours} />
              <button className="bouton bouton--principal bouton--grand" onClick={() => void distribuer()} disabled={!peutDistribuer}>
                {encours ? 'Distribution…' : partie ? 'Nouvelle main' : 'Distribuer'}
              </button>
            </>
          )}
          {erreur && <p className="alerte" role="alert" style={{ marginTop: '1rem' }}>{erreur}</p>}
        </aside>
      </div>

      <SousLeCapot>
        <p>
          Le blackjack est le seul jeu qui se joue en plusieurs coups. Entre deux actions,
          la main reste <code>en_cours</code> dans la table <code>parties</code> et son état
          (cartes du joueur et du croupier) est stocké en <code>jsonb</code>. Rechargez la
          page en pleine main : elle est reprise telle quelle.
        </p>
        <p>
          Les boutons proposés viennent de la base : <code>_bj_vue()</code> renvoie la liste
          des actions permises selon l'état réel de la main. Le front ne connaît aucune règle
          du blackjack. La seconde carte du croupier n'est envoyée qu'une fois la main
          terminée : impossible de la lire dans les outils du navigateur.
        </p>
      </SousLeCapot>
    </>
  );
}
