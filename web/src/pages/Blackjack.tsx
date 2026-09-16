import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { jetons, useSolde } from '../lib/solde';

interface Main {
  cartes: string[];
  total: number;
}

interface Partie {
  partie_id: number;
  mise: number;
  gain: number;
  statut: 'en_cours' | 'terminee';
  resultat: string | null;
  joueur: Main;
  croupier: Main;
  actions: string[];
  solde: number;
}

const LIBELLES: Record<string, string> = {
  blackjack: 'Blackjack ! Paye 3:2',
  gagne: 'Gagne',
  egalite: 'Egalite, mise rendue',
  perdu: 'Perdu',
};

function Carte({ valeur }: { valeur: string }) {
  if (valeur === '??') return <div className="carte-a-jouer cachee">?</div>;
  const rouge = valeur.includes('♥') || valeur.includes('♦');
  return <div className={`carte-a-jouer ${rouge ? 'rouge' : ''}`}>{valeur}</div>;
}

export function Blackjack() {
  const [mise, setMise] = useState(20);
  const [partie, setPartie] = useState<Partie | null>(null);
  const [erreur, setErreur] = useState('');
  const [encours, setEncours] = useState(false);
  const { poser, rafraichir } = useSolde();

  // Une main interrompue (onglet ferme, rechargement) reste 'en_cours' dans la
  // base : son etat vit dans parties.etat en jsonb, pas dans le navigateur.
  useEffect(() => {
    api.get<{ partie_id: number } | null>('/jeux/blackjack/en-cours')
      .then((p) => { if (p) setErreur('Une main est deja en cours : tirez ou restez pour la terminer.'); })
      .catch(() => {});
  }, []);

  async function appeler(chemin: string, corps: unknown) {
    setErreur('');
    setEncours(true);
    try {
      const p = await api.post<Partie>(chemin, corps);
      setPartie(p);
      poser(Number(p.solde));
    } catch (err) {
      setErreur((err as Error).message);
      await rafraichir();
    } finally {
      setEncours(false);
    }
  }

  const distribuer = () => appeler('/jeux/blackjack', { mise });
  const agir = (action: string) =>
    appeler('/jeux/blackjack/action', { partieId: partie!.partie_id, action });

  const enJeu = partie?.statut === 'en_cours';

  return (
    <>
      <h1>Blackjack</h1>
      <p className="sous-titre">
        Le croupier tire jusqu&apos;a 17. Blackjack paye 3:2. RTP annonce : 99,50 %.
      </p>

      {erreur && <div className="erreur">{erreur}</div>}

      <div className="tapis">
        {partie ? (
          <>
            <div className="mains">
              <div className="main-joueur">
                <div className="pastille">Croupier</div>
                <div className="main-cartes" style={{ marginTop: '0.5rem' }}>
                  {partie.croupier.cartes.map((c, i) => <Carte key={i} valeur={c} />)}
                </div>
                <div className="total">{partie.croupier.total}{enJeu && ' +'}</div>
              </div>

              <div className="main-joueur">
                <div className="pastille">Vous</div>
                <div className="main-cartes" style={{ marginTop: '0.5rem' }}>
                  {partie.joueur.cartes.map((c, i) => <Carte key={i} valeur={c} />)}
                </div>
                <div className="total">{partie.joueur.total}</div>
              </div>
            </div>

            {!enJeu && partie.resultat && (
              <p style={{ margin: 0 }}>
                <strong>{LIBELLES[partie.resultat] ?? partie.resultat}</strong>
                {' — '}
                {Number(partie.gain) > Number(partie.mise)
                  ? <span className="gain">+{jetons(Number(partie.gain) - Number(partie.mise))} jetons</span>
                  : Number(partie.gain) === Number(partie.mise)
                    ? <span className="discret">mise rendue</span>
                    : <span className="perte">−{jetons(partie.mise)} jetons</span>}
              </p>
            )}
          </>
        ) : (
          <p className="discret">Choisissez votre mise et demandez les cartes.</p>
        )}
      </div>

      <div className="carte">
        {enJeu ? (
          <div className="boutons">
            {partie!.actions.includes('tirer') && (
              <button onClick={() => void agir('tirer')} disabled={encours}>Tirer</button>
            )}
            {partie!.actions.includes('rester') && (
              <button className="principal" onClick={() => void agir('rester')} disabled={encours}>Rester</button>
            )}
            {partie!.actions.includes('doubler') && (
              <button onClick={() => void agir('doubler')} disabled={encours}>
                Doubler ({jetons(partie!.mise)} de plus)
              </button>
            )}
          </div>
        ) : (
          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div style={{ width: 180 }}>
              <label htmlFor="mise">Mise (1 a 500 jetons)</label>
              <input id="mise" type="number" min={1} max={500} value={mise}
                     onChange={(e) => setMise(Number(e.target.value))} />
            </div>
            <button className="principal" onClick={() => void distribuer()} disabled={encours}>
              {encours ? 'Distribution...' : 'Distribuer'}
            </button>
          </div>
        )}

        <p className="notice">
          Les actions proposees viennent de la base : <code className="mono">_bj_vue()</code> renvoie
          la liste <code className="mono">actions</code> selon l&apos;etat reel de la main. Le front
          n&apos;a aucune regle de blackjack a connaitre — il affiche ce qu&apos;on l&apos;autorise a proposer.
        </p>
      </div>
    </>
  );
}
